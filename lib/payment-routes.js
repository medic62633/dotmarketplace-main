const crypto = require('crypto');
const payments = require('./payments');
const { calcDealFees, feeConfig } = require('./fees');
const { isOutOfStock, everStocked } = require('./stock-deliver');
const { isId } = require('./validate');

/* Pending crypto invoices are abandoned all the time; without a TTL they wedge
 * the deal forever (the buyer can neither re-pay nor buy the listing again).
 * syncProviderPayment flips stale pending records to 'expired', and expired is
 * repayable everywhere. Overridable for tests. */
const PENDING_TTL_MS = Number(process.env.PAYMENT_PENDING_TTL_MS) > 0
  ? Number(process.env.PAYMENT_PENDING_TTL_MS)
  : 60 * 60 * 1000;

function registerPaymentRoutes(app, { authUser, paymentStore, sellerStore, walletStore, onPaymentPaid, paymentLimiter, stockStore }) {
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

    let creditAmount = record.amount;
    if (record.provider === 'oxapay') {
      const confirmed = payments.oxapay.extractPaidAmount(record._providerInfo);
      if (confirmed != null) creditAmount = Math.min(record.amount, confirmed);
    }
    creditAmount = Math.round((Number(creditAmount) || 0) * 100) / 100;

    const patch = { paidSource: 'deposit' };
    if (creditAmount > 0 && creditAmount !== record.amount) patch.creditedAmount = creditAmount;
    delete record._providerInfo;

    const { claimed, doc } = await paymentStore.claimPaid(record._id, patch);
    if (!claimed) return doc || record;

    if (walletStore && doc.buyerEmail && creditAmount > 0) {
      // Only the local-simulate endpoint can ever reach 'paid' when OxaPay
      // isn't configured, so that combination is an unambiguous signal.
      const lbl = payments.oxapay.configured() ? 'Deposit · OxaPay' : 'Deposit · Simulated';
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

      if (!payments.isConfigured()) {
        return res.status(503).json({
          error: 'payments_unconfigured',
          msg: 'Crypto payments not configured — add OXAPAY_MERCHANT_API_KEY to .env or use Dot Wallet',
        });
      }

      let record = await paymentStore.getByOrderId(orderId);
      if (record?.status === 'paid') {
        if (record.buyerEmail !== user._id) {
          return res.status(403).json({ error: 'forbidden', msg: 'Order belongs to another buyer' });
        }
        return res.json({ payment: serializePayment(record), fees: feesFromRecord(record) });
      }
      if (record && record.buyerEmail !== user._id) {
        return res.status(403).json({ error: 'forbidden', msg: 'Order belongs to another buyer' });
      }

      // Never mint a second invoice for the same orderId — return the existing
      // pending checkout (or sync it) so the buyer can't pay twice.
      if (record?.status === 'pending') {
        record = await syncProviderPayment(record);
        if (record.status === 'paid') {
          return res.json({ payment: serializePayment(record), fees: feesFromRecord(record) });
        }
        if (record.status === 'pending' && record.payUrl) {
          return res.json({ payment: serializePayment(record), fees: feesFromRecord(record) });
        }
        // expired/cancelled or payUrl-less pending: mint a fresh invoice below
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
      const provider = payments.provider();
      const dealFees = calcDealFees(amt, { provider, method: method || 'trc20' });
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
          method: method || 'trc20',
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
        providerPaymentId: invoice.providerPaymentId,
        payUrl: invoice.payUrl,
        payAddress: invoice.payAddress || null,
        payAmount: invoice.payAmount || null,
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

      res.json({ payment: serializePayment(record), fees: dealFees });
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
      } else if (!record.payNetwork && record.provider === 'oxapay' && record.providerPaymentId) {
        await payments.oxapay.enrichRecordNetwork(record);
        if (record.payNetwork) await paymentStore.save(record);
      }
      res.json({ payment: serializePayment(record), fees: feesFromRecord(record) });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  /* Provider statuses where the invoice is dead — the money will never arrive.
   * Flipping to 'expired' locally stops the forever-poll and frees the deal. */
  const PROVIDER_DEAD = new Set(['expired', 'cancelled', 'canceled', 'failed', 'error', 'refunded']);

  /* Release this order's stock reservation (if any). Safe to call repeatedly. */
  async function releaseOrderReservation(orderId) {
    if (stockStore && typeof stockStore.releaseReservation === 'function') {
      try { await stockStore.releaseReservation(String(orderId)); } catch (_) {}
    }
  }

  async function syncProviderPayment(record) {
    if (!record || ['paid', 'cancelled', 'expired'].includes(record.status)) return record;

    // Provider-reported terminal states + local TTL both end a pending invoice.
    if (record.provider === 'oxapay' && record.providerPaymentId) {
      try {
        const info = await payments.oxapay.getPaymentInfo(record.providerPaymentId);
        if (info && payments.oxapay.isPaidStatus(info.status)) {
          return markPaid(record, 'oxapay_poll', info);
        }
        if (info && PROVIDER_DEAD.has(String(info.status || '').toLowerCase())) {
          const t = await paymentStore.claimTerminal(record._id, 'expired');
          if (t.claimed) await releaseOrderReservation(record.orderId);
          return t.doc || record;
        }
      } catch (err) {
        console.error('oxapay status sync error:', err.message);
      }
    }

    // Local TTL — an abandoned checkout expires even if the provider keeps the
    // invoice "pending" forever.
    const created = new Date(record.expiresAt || record.createdAt || 0).getTime();
    if (created && Date.now() - created > PENDING_TTL_MS) {
      const t = await paymentStore.claimTerminal(record._id, 'expired');
      if (t.claimed) await releaseOrderReservation(record.orderId);
      return t.doc || record;
    }
    return record;
  }

  function applyProviderDetails(record, payload) {
    if (!payload || record.provider !== 'oxapay') return;
    const details = payments.oxapay.extractPaymentDetails(payload);
    if (details.payNetwork) Object.assign(record, details);
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
      const record = await paymentStore.getByOrderId(orderId);
      if (!record || record.buyerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      if (record.status === 'paid') {
        return res.status(409).json({ error: 'bad_state', msg: 'This order is already paid — open a dispute instead' });
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

  app.post('/api/webhooks/oxapay', async (req, res) => {
    try {
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const hmac = req.headers.hmac || req.headers.HMAC;
      const body = req.body || {};

      if (!payments.oxapay.verifyWebhook(rawBody, hmac)) {
        return res.status(401).send('Invalid HMAC signature');
      }

      const orderId = body.order_id;
      const record = orderId ? await paymentStore.getByOrderId(orderId) : null;
      if (record && payments.oxapay.isPaidStatus(body.status)) {
        if (record.purpose === 'deposit') {
          record._providerInfo = body;
          await creditDeposit(record);
        } else {
          await markPaid(record, 'oxapay_webhook', body);
        }
      }
      res.status(200).send('ok');
    } catch (err) {
      console.error('oxapay webhook error:', err.message);
      res.status(500).send('error');
    }
  });

  app.post('/api/webhooks/cryptomus', async (req, res) => {
    try {
      const body = req.body || {};
      const sig = body.sign;
      if (!payments.cryptomus.verifyWebhook(body, sig)) {
        return res.status(401).json({ error: 'invalid signature' });
      }
      const orderId = body.order_id;
      const record = orderId ? await paymentStore.getByOrderId(orderId) : null;
      if (record && payments.cryptomus.isPaidStatus(body.status)) {
        if (record.purpose === 'deposit') {
          await creditDeposit(record);
        } else {
          await markPaid(record, 'cryptomus_webhook');
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('cryptomus webhook error:', err.message);
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
    provider: record.provider,
    method: record.method,
    payNetwork: record.payNetwork || null,
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
