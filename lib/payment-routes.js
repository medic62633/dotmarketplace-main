const crypto = require('crypto');
const payments = require('./payments');
const { calcDealFees, feeConfig } = require('./fees');
const { isOutOfStock, everStocked } = require('./stock-deliver');
const { isId } = require('./validate');
const { checkOrderOwner } = require('./order-owner');

/* Pending crypto invoices are abandoned all the time; without a TTL they wedge
 * the deal forever (the buyer can neither re-pay nor buy the listing again).
 * syncProviderPayment flips stale pending records to 'expired', and expired is
 * repayable everywhere. Overridable for tests. */
const PENDING_TTL_MS = Number(process.env.PAYMENT_PENDING_TTL_MS) > 0
  ? Number(process.env.PAYMENT_PENDING_TTL_MS)
  : 60 * 60 * 1000;

function registerPaymentRoutes(app, { authUser, paymentStore, sellerStore, walletStore, onPaymentPaid, paymentLimiter, stockStore, cryptoAddressStore }) {
  const payLimit = paymentLimiter || ((req, res, next) => next());
  /* Small in-memory "already handled" cache on top of the atomic claimPaid.
   * FIFO eviction keeps fresh entries instead of clearing the whole set. */
  const paidOrders = new Set();
  function rememberPaid(orderId) {
    if (!orderId) return;
    if (paidOrders.has(orderId)) paidOrders.delete(orderId); // refresh recency
    paidOrders.add(orderId);
    if (paidOrders.size > 5000) {
      const oldest = paidOrders.values().next().value;
      paidOrders.delete(oldest);
    }
  }

  /**
   * Credit a confirmed wallet top-up (deposit) to the buyer's wallet. Durable
   * and idempotent — an already-paid deposit is never credited twice, even
   * after a restart or a webhook + poll racing each other.
   */
  async function creditDeposit(record) {
    if (!record || record.purpose !== 'deposit') return record;
    if (record.status === 'paid') return record;

    const creditAmount = Math.round((Number(record.amount) || 0) * 100) / 100;
    const patch = { paidSource: 'deposit' };

    const { claimed, doc } = await paymentStore.claimPaid(record._id, patch);
    if (!claimed) return doc || record;

    if (walletStore && doc.buyerEmail && creditAmount > 0) {
      // A native on-chain deposit is always real money (see
      // lib/payments/index.js's sandboxEnabled — there's no simulate mode
      // for these); label it by chain. Only the local-simulate endpoint can
      // ever reach 'paid' when no native provider is configured, so that
      // case is the unambiguous simulated one.
      const nativeLabel = payments.NATIVE_NETWORK_LABELS[doc.provider];
      const lbl = nativeLabel ? `Deposit · ${nativeLabel.payNetwork}` : 'Deposit · Simulated';
      await walletStore.deposit(doc.buyerEmail, creditAmount, lbl);
    }
    return doc;
  }

  app.get('/api/payments/config', (req, res) => {
    const fees = feeConfig();
    res.json({
      provider: payments.provider(),
      configured: payments.isConfigured(),
      sandbox: payments.sandboxEnabled(),
      fees,
    });
  });

  app.post('/api/payments/escrow', payLimit, async (req, res) => {
    try {
      const user = await authUser(req);
      if (!user) return res.status(401).json({ error: 'unauthorized' });

      const {
        orderId, listingId, method, variantId,
      } = req.body || {};
      if (!isId(orderId)) {
        return res.status(400).json({ error: 'bad request', msg: 'Invalid payment details' });
      }

      // Same ownership rule the wallet path enforces (lib/order-owner.js).
      // The record checks below already cover a payment doc for this order;
      // this also catches an order id whose ESCROW is another buyer's — a
      // wallet purchase always writes both, but a payment record that failed
      // to save would otherwise leave the escrow the only evidence.
      //
      // Ahead of the provider-configured gate on purpose: whether this server
      // happens to have crypto enabled has no bearing on whether the caller
      // may touch this order id, and putting it first keeps the rule testable
      // on a wallet-only deployment.
      const taken = await checkOrderOwner({
        sellerStore, paymentStore, orderId: String(orderId), buyerEmail: user._id,
      });
      if (taken) return res.status(409).json({ error: taken.code, msg: taken.msg });

      if (!payments.isConfigured()) {
        return res.status(503).json({
          error: 'payments_unconfigured',
          msg: 'Crypto payments not configured on this server — use Dot Wallet',
        });
      }

      let record = await paymentStore.getByOrderId(orderId);
      if (record?.status === 'paid') {
        if (record.buyerEmail !== user._id) {
          return res.status(403).json({ error: 'forbidden', msg: 'Order belongs to another buyer' });
        }
        return res.json({ payment: serializePayment(record), fees: feesFromRecord(record), progress: payments.paymentProgress(record) });
      }
      if (record && record.buyerEmail !== user._id) {
        return res.status(403).json({ error: 'forbidden', msg: 'Order belongs to another buyer' });
      }

      // Never mint a second invoice for the same orderId — return the existing
      // pending checkout (or sync it) so the buyer can't pay twice.
      if (record?.status === 'pending') {
        record = await syncProviderPayment(record);
        if (record.status === 'paid') {
          return res.json({ payment: serializePayment(record), fees: feesFromRecord(record), progress: payments.paymentProgress(record) });
        }
        // A live invoice already exists — payUrl for a redirect-style checkout,
        // payAddress for a native on-chain one. Re-minting either would, for a
        // native provider, re-read its balance/block-height context from
        // scratch (see e.g. native-solana.js's balance-delta detection) and
        // silently erase any transfer already observed on this record
        // (nativeFirstSeenAt/nativeContext), resetting the confirmation clock
        // and potentially making an already-paid transfer undetectable.
        if (record.status === 'pending' && (record.payUrl || record.payAddress)) {
          return res.json({ payment: serializePayment(record), fees: feesFromRecord(record), progress: payments.paymentProgress(record) });
        }
        // expired/cancelled or invoice-less pending: mint a fresh invoice below
        // on the same record (reserving stock again if it was released).
      }

      // Server-authoritative listing lookup — never trust client-supplied
      // amount/seller. A buyer could name themselves (or anyone) as the
      // seller and mint fake escrows, or pay an invented price. The listing
      // is the source of truth, exactly like the wallet path.
      const listing = (listingId && sellerStore) ? await sellerStore.getListing(String(listingId)) : null;
      if (!listing || listing.status !== 'active') {
        return res.status(404).json({ error: 'not found', msg: 'Listing not found or no longer available' });
      }
      if (listing.sellerEmail === user._id) {
        return res.status(400).json({ error: 'bad request', msg: 'You cannot buy your own listing' });
      }
      // A revoked seller's listings can linger as 'active' after admin reject —
      // never take money for them. Missing profiles are tolerated (legacy/demo
      // sellers); an explicitly unverified one is not.
      const sellerProfile = typeof sellerStore.getSellerProfile === 'function'
        ? await sellerStore.getSellerProfile(listing.sellerEmail)
        : null;
      if (sellerProfile && sellerProfile.verified === false) {
        return res.status(403).json({ error: 'forbidden', msg: 'This seller is no longer verified' });
      }
      // Multi-price listings (e.g. $10/$50/$100 gift cards on one listing):
      // the buyer picks a variant, but the price is always looked up server-side
      // from the listing's own recorded variants — never trusted from the client.
      const hasVariants = Array.isArray(listing.variants) && listing.variants.length > 0;
      let variant = null;
      if (hasVariants) {
        variant = listing.variants.find(v => v.id === String(variantId || ''));
        if (!variant) {
          return res.status(400).json({ error: 'bad request', msg: 'Choose a valid price option for this listing' });
        }
      }
      const amt = Math.round((Number(variant ? variant.price : listing.price) || 0) * 100) / 100;
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'bad request', msg: 'Invalid listing price' });
      }
      const resolvedVariantId = variant ? variant.id : null;
      // Auto-delivery listings: atomically RESERVE a unit for this order before
      // minting the invoice. The out-of-stock check and the claim are now one
      // step, so two concurrent buyers of a 1-unit listing can't both pass the
      // check, both pay, and leave one with captured funds and no goods.
      // Only a listing/variant that actually has a stock pool needs (or can
      // survive) a reservation attempt — reserveOne on a manual-delivery
      // listing/variant (never stocked) would always find nothing to reserve
      // and wrongly report every single purchase as "out of stock".
      const isStocked = stockStore && (await everStocked(stockStore, listing._id, resolvedVariantId));
      if (isStocked && (await isOutOfStock({ stockStore, listingId: listing._id, variantId: resolvedVariantId }))) {
        return res.status(409).json({ error: 'out_of_stock', msg: 'This item is out of stock' });
      }
      let stockReserved = false;
      if (isStocked && typeof stockStore.reserveOne === 'function') {
        const reserved = await stockStore.reserveOne(String(listing._id), String(orderId), user._id, resolvedVariantId);
        if (reserved.empty) {
          return res.status(409).json({ error: 'out_of_stock', msg: 'This item is out of stock' });
        }
        stockReserved = !!reserved.doc;
      }
      const title = variant ? `${String(listing.title || '').slice(0, 180)} — ${variant.label}` : String(listing.title || '').slice(0, 200);
      const sellerEmail = listing.sellerEmail;
      const sellerName = listing.sellerName || '';

      const description = `${title || 'Marketplace order'} · ${orderId}`;
      const dealFees = calcDealFees(amt, { method: method || 'trc20' });
      // Atomically claim the orderId BEFORE calling the provider — otherwise
      // two concurrent first checkouts mint two live invoices and one insert
      // dies on the unique orderId index with money already in flight.
      const claim = await paymentStore.claimCheckout(orderId, user._id);
      if (!claim.won) {
        if (stockReserved) {
          try { await stockStore.releaseReservation(String(orderId)); } catch (_) {}
        }
        return res.status(409).json({ error: 'in_progress', msg: 'Checkout already in progress for this order — retry in a moment' });
      }
      let invoice;
      try {
        invoice = await payments.createEscrowInvoice({
          orderId,
          amount: dealFees.buyerTotal,
          description,
        });
      } catch (invErr) {
        // Invoice never got minted — release the checkout claim and hand the
        // reserved unit back immediately.
        try { await paymentStore.releaseCheckout(orderId, claim.prevStatus); } catch (_) {}
        if (stockReserved) {
          try { await stockStore.releaseReservation(String(orderId)); } catch (_) {}
        }
        throw invErr;
      }

      // Known immediately at invoice creation (not just once paid) so the
      // pending-payment screen can name the exact network/currency the buyer
      // must send, instead of a generic placeholder.
      const networkLabel = payments.NATIVE_NETWORK_LABELS[invoice.provider] || null;

      record = {
        _id: claim.doc?._id || record?._id || crypto.randomBytes(12).toString('hex'),
        orderId,
        buyerEmail: user._id,
        amount: dealFees.listingAmount,
        listingAmount: dealFees.listingAmount,
        buyerTotal: dealFees.buyerTotal,
        title: title || '',
        listingId: listingId || null,
        variantId: resolvedVariantId,
        variantLabel: variant ? variant.label : null,
        sellerEmail: sellerEmail || '',
        sellerName: sellerName || '',
        method: method || 'trc20',
        provider: invoice.provider,
        payNetwork: networkLabel?.payNetwork || null,
        payCurrency: networkLabel?.payCurrency || null,
        networkLabel: networkLabel?.networkLabel || null,
        payDecimals: networkLabel?.decimals ?? 2,
        providerPaymentId: invoice.providerPaymentId,
        payUrl: invoice.payUrl,
        payAddress: invoice.payAddress || null,
        payAmount: invoice.payAmount || null,
        // Set only for non-USD-pegged chains (BTC/LTC/native SOL) — the USD
        // figure payAmount was converted from, at the exchange rate locked
        // in for this invoice's lifetime. Lets the UI show "≈ $X" next to
        // the coin amount. null for USDT-denominated chains (payAmount IS
        // already the USD figure there).
        payAmountUsd: invoice.payAmountUsd ?? null,
        // Chain-specific scan context a native provider's checkAddressForPayment
        // needs back on every poll (e.g. EVM's starting block, Solana/UTXO's
        // prior balance) — see lib/payments/native-tron.js's doc comment.
        // null for native_tron (no context needed).
        nativeContext: invoice.context || null,
        platformFee: dealFees.platformFee,
        platformFeePercent: dealFees.platformFeePercent,
        gatewayFee: dealFees.gatewayFee,
        gatewayFeePercent: dealFees.gatewayFeePercent,
        gatewayFeePaidBy: dealFees.gatewayFeePaidBy,
        sellerNet: dealFees.sellerNet,
        merchantNet: dealFees.merchantNet,
        status: 'pending',
        createdAt: record?.createdAt || new Date(),
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      };
      delete record.expiredAt;
      delete record.cancelledAt;
      await paymentStore.save(record);

      res.json({ payment: serializePayment(record), fees: dealFees, progress: payments.paymentProgress(record) });
    } catch (err) {
      console.error('create escrow payment error:', err.message);
      res.status(500).json({ error: 'server', msg: err.message });
    }
  });

  app.get('/api/payments/status/:orderId', async (req, res) => {
    try {
      const user = await authUser(req);
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      let record = await paymentStore.getByOrderId(req.params.orderId);
      if (!record || record.buyerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      if (record.status !== 'paid') {
        record = await syncProviderPayment(record);
      }
      res.json({ payment: serializePayment(record), fees: feesFromRecord(record), progress: payments.paymentProgress(record) });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  /* Release this order's stock reservation (if any). Safe to call repeatedly. */
  async function releaseOrderReservation(orderId) {
    if (stockStore && typeof stockStore.releaseReservation === 'function') {
      try { await stockStore.releaseReservation(String(orderId)); } catch (_) {}
    }
    if (cryptoAddressStore && typeof cryptoAddressStore.releaseForOrder === 'function') {
      try { await cryptoAddressStore.releaseForOrder(String(orderId)); } catch (_) {}
    }
  }

  async function syncProviderPayment(record) {
    if (!record || ['paid', 'cancelled', 'expired'].includes(record.status)) return record;

    // Any native (no-processor) chain provider (TRON, EVM, Solana, UTXO —
    // see lib/payments/index.js's NATIVE_PROVIDERS registry) is handled
    // identically here: poll for an observed transfer, then wait out that
    // provider's confirmWindowMs() once one is seen before marking paid.
    const native = payments.NATIVE_PROVIDERS[record.provider];
    if (native && record.payAddress) {
      try {
        // record.payAmount is what the invoice actually quoted the buyer —
        // already converted to the chain's own currency for BTC/LTC/native
        // SOL (see lib/payments/fx.js). record.buyerTotal/amount are USD(T)
        // figures and would be the wrong unit entirely for those three, so
        // the USD fallback is only safe on a USD-pegged network. On a
        // non-pegged one a missing payAmount means we'd be asking "did 20 BTC
        // arrive?" for a $20 order; refuse the check instead, leaving the
        // record pending for a human rather than silently never matching (or,
        // on a cheap coin, matching far too easily).
        const label = payments.NATIVE_NETWORK_LABELS[record.provider];
        const usdPegged = !label || label.payCurrency === 'USDT';
        const expected = record.payAmount ?? (usdPegged ? (record.buyerTotal ?? record.amount) : null);
        if (expected == null) {
          throw new Error(`${record.provider}: record has no payAmount and ${label?.payCurrency || 'this currency'} is not USD-pegged — refusing to compare a USD figure against a coin amount`);
        }
        const seen = await native.checkAddressForPayment(record.payAddress, expected, payments.nativeContextFor(record));
        if (seen.found && !record.nativeFirstSeenAt) {
          // A targeted atomic $set (guarded on the record still being
          // 'pending' with no prior sighting) — not a blind save() of this
          // whole in-memory object, which could otherwise silently revert a
          // concurrent legitimate change (an admin's manual cancel, another
          // poll's own claimPaid) landing on the same document in the tiny
          // window between this read and this write.
          const rec = await paymentStore.recordNativeSeen(record._id, {
            nativeFirstSeenAt: new Date(),
            nativeTxId: seen.txId,
            nativeFrom: seen.from,
          });
          if (rec.doc) record = rec.doc;
        }
      } catch (err) {
        console.error(record.provider + ' status sync error:', err.message);
      }

      // The record may have moved to a terminal state via the concurrent
      // write recordNativeSeen just guarded against — re-check rather than
      // proceed on a stale in-memory copy.
      if (['paid', 'cancelled', 'expired'].includes(record.status)) return record;

      // record.nativeFirstSeenAt is sticky once set — checked here regardless
      // of what THIS call to checkAddressForPayment just returned. A real
      // transfer was already observed on a prior poll; a transient RPC
      // hiccup or a chain reorg blip on this one call must never make that
      // evidence disappear. Without this, the TTL-expiry check below could
      // fire on a record with real money already sitting on its address —
      // marking it 'expired' and releasing that address back into the pool
      // for reassignment, permanently orphaning the buyer's deposit with no
      // remaining code path that ever credits or refunds it.
      if (record.nativeFirstSeenAt) {
        const waited = Date.now() - new Date(record.nativeFirstSeenAt).getTime();
        if (waited >= native.confirmWindowMs()) {
          return markPaid(record, record.provider + '_poll', { txId: record.nativeTxId });
        }
        return record;
      }
    }

    // Local TTL — an abandoned checkout (nothing ever observed on-chain for
    // it) expires even if the provider keeps the invoice "pending" forever.
    // Never reached once nativeFirstSeenAt is set — see above.
    //
    // Compares directly against record.expiresAt (already createdAt +
    // PENDING_TTL_MS, set once at invoice creation) — NOT
    // createdAt + 2×PENDING_TTL_MS. This used to add PENDING_TTL_MS a
    // second time on top of expiresAt before actually expiring anything,
    // silently doubling the real payable window past what expiresAt (and
    // the buyer-facing countdown timer built from it) promises.
    const deadline = record.expiresAt
      ? new Date(record.expiresAt).getTime()
      : (record.createdAt ? new Date(record.createdAt).getTime() + PENDING_TTL_MS : 0);
    if (deadline && Date.now() > deadline) {
      const t = await paymentStore.claimTerminal(record._id, 'expired');
      if (t.claimed) await releaseOrderReservation(record.orderId);
      return t.doc || record;
    }
    return record;
  }

  function applyProviderDetails(record, payload) {
    if (!payload) return;
    if (payments.NATIVE_NETWORK_LABELS[record.provider]) {
      Object.assign(record, payments.NATIVE_NETWORK_LABELS[record.provider]);
      record.payTxNetwork = record.provider;
      if (payload.txId) record.nativeTxId = payload.txId;
    }
  }

  async function markPaid(record, source, providerPayload) {
    if (record.status === 'paid') return record;
    if (paidOrders.has(record.orderId)) {
      const fresh = await paymentStore.getByOrderId(record.orderId);
      if (fresh?.status === 'paid') return fresh;
    }

    applyProviderDetails(record, providerPayload);
    const patch = { paidSource: source };
    if (record.payNetwork) patch.payNetwork = record.payNetwork;
    if (record.payTxNetwork) patch.payTxNetwork = record.payTxNetwork;
    if (record.payCurrency) patch.payCurrency = record.payCurrency;

    const { claimed, doc } = await paymentStore.claimPaid(record._id, patch);
    if (!claimed) {
      if (doc?.status === 'paid') rememberPaid(record.orderId);
      return doc || record;
    }
    rememberPaid(record.orderId);

    if (doc.sellerEmail && sellerStore) {
      if (typeof sellerStore.recordSale === 'function') {
        await sellerStore.recordSale(doc.sellerEmail);
      }
      await sellerStore.holdEscrow({
        dealId: doc.orderId,
        buyerEmail: doc.buyerEmail,
        sellerEmail: doc.sellerEmail,
        amount: doc.amount,
        method: doc.method,
        title: doc.title,
      });
    }
    if (onPaymentPaid) await onPaymentPaid(doc);
    return doc;
  }

  /* Buyer abandons a pending crypto checkout: flips the invoice to 'cancelled'
   * and hands the reserved stock unit back to the pool so the listing isn't
   * blocked by a checkout that will never complete. */
  app.post('/api/payments/cancel', payLimit, async (req, res) => {
    try {
      const user = await authUser(req);
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      const orderId = String((req.body || {}).orderId || '');
      if (!orderId) return res.status(400).json({ error: 'bad request', msg: 'orderId is required' });
      let record = await paymentStore.getByOrderId(orderId);
      if (!record || record.buyerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      if (record.status === 'paid') {
        return res.status(409).json({ error: 'bad_state', msg: 'This order is already paid — open a dispute instead' });
      }
      // Sync first — a transfer may already be sitting on this order's
      // deposit address (sent moments ago, not yet reflected in what the
      // buyer's UI shows) even though the record still reads 'pending'.
      // Cancelling out from under it would flip the record to 'cancelled'
      // and release that address back into the pool for reassignment while
      // real money is still on it, with no remaining code path that ever
      // credits or refunds the buyer for it.
      if (record.status === 'pending') {
        record = await syncProviderPayment(record);
        if (record.status === 'paid') {
          return res.status(409).json({ error: 'bad_state', msg: 'This order was just paid — open a dispute instead' });
        }
        if (record.nativeFirstSeenAt) {
          return res.status(409).json({
            error: 'payment_detected',
            msg: 'A payment to this address was already detected on-chain — wait for it to confirm instead of cancelling. Contact support if this seems wrong.',
          });
        }
      }
      const t = await paymentStore.claimTerminal(record._id, 'cancelled');
      if (!t.claimed && t.doc?.status === 'paid') {
        return res.status(409).json({ error: 'bad_state', msg: 'This order was just paid — open a dispute instead' });
      }
      await releaseOrderReservation(orderId);
      res.json({ ok: true, status: t.doc?.status || 'cancelled' });
    } catch (err) {
      console.error('cancel payment error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  return { markPaid, creditDeposit };
}

function feesFromRecord(record) {
  if (record.listingAmount != null || record.buyerTotal != null) {
    return {
      listingAmount: record.listingAmount ?? record.amount,
      amount: record.amount,
      buyerTotal: record.buyerTotal ?? record.amount,
      platformFee: record.platformFee,
      platformFeePercent: record.platformFeePercent,
      gatewayFee: record.gatewayFee,
      gatewayFeePercent: record.gatewayFeePercent,
      gatewayFeePaidBy: record.gatewayFeePaidBy,
      sellerNet: record.sellerNet,
      merchantNet: record.merchantNet,
    };
  }
  return calcDealFees(record.amount, { provider: record.provider, method: record.method });
}

function serializePayment(record) {
  return {
    id: record._id,
    orderId: record.orderId,
    amount: record.amount,
    listingAmount: record.listingAmount ?? record.amount,
    buyerTotal: record.buyerTotal ?? record.amount,
    status: record.status,
    payUrl: record.payUrl,
    payAddress: record.payAddress,
    payAmount: record.payAmount,
    payAmountUsd: record.payAmountUsd ?? null,
    payDecimals: record.payDecimals ?? 2,
    provider: record.provider,
    method: record.method,
    payNetwork: record.payNetwork || null,
    payCurrency: record.payCurrency || null,
    networkLabel: record.networkLabel || null,
    paidAt: record.paidAt || null,
    expiresAt: record.expiresAt || null,
    refundStatus: record.refundStatus || null,
    platformFee: record.platformFee ?? null,
    platformFeePercent: record.platformFeePercent ?? null,
    gatewayFee: record.gatewayFee ?? null,
    gatewayFeePercent: record.gatewayFeePercent ?? null,
    gatewayFeePaidBy: record.gatewayFeePaidBy ?? null,
    sellerNet: record.sellerNet ?? null,
  };
}

module.exports = { registerPaymentRoutes };
