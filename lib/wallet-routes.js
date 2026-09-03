/* Buyer wallet API. The server owns the balance; these endpoints are the only
 * way it changes. Wallet payment debits funds and opens the escrow hold in one
 * atomic step so a browser can never fund a deal it didn't pay for.
 *
 * Top-ups are funded directly on-chain via whichever native crypto provider
 * PAYMENT_PROVIDER selects (see lib/payments/index.js's NATIVE_PROVIDERS):
 * the wallet is credited only once a transfer to the assigned deposit
 * address is observed and its confirm window has elapsed, or — when no
 * provider is configured, in dev/demo only — via a local simulate.
 */
const crypto = require('crypto');
const payments = require('./payments');
const { autoDeliver, isOutOfStock, everStocked } = require('./stock-deliver');
const notify = require('./order-notify');
const { isId } = require('./validate');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const MIN_TOPUP = 5;
const MAX_TOPUP = 100000;
const TOPUP_TTL_MS = 60 * 60 * 1000;

function registerWalletRoutes(app, { authUser, walletStore, sellerStore, paymentStore, creditDeposit, paymentLimiter, stockStore }) {
  const payLimit = paymentLimiter || ((req, res, next) => next());
  async function requireAuth(req, res) {
    const user = await authUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    return user;
  }

  app.get('/api/wallet', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const w = await walletStore.ensureWallet(user._id);
      res.json({ wallet: walletStore.serialize(w) });
    } catch (err) {
      console.error('wallet get error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // Start a wallet top-up. Claims a deposit address from whichever native
  // provider is configured; the wallet is credited only once a transfer is
  // observed on-chain (see /api/wallet/topup/:orderId below).
  app.post('/api/wallet/topup', payLimit, async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      let amount = parseFloat((req.body || {}).amount);
      if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
        return res.status(400).json({ error: 'amount', msg: `Minimum top-up is ${MIN_TOPUP} USDT` });
      }
      if (amount > MAX_TOPUP) amount = MAX_TOPUP;
      amount = round2(amount);

      const orderId = 'TOP-' + crypto.randomBytes(6).toString('hex');
      const record = {
        _id: crypto.randomBytes(12).toString('hex'),
        orderId,
        purpose: 'deposit',
        buyerEmail: user._id,
        amount,
        provider: payments.provider(),
        method: payments.provider(),
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + TOPUP_TTL_MS),
      };

      const native = payments.NATIVE_PROVIDERS[payments.provider()];
      if (native && native.configured()) {
        const invoice = await native.createInvoice({ orderId, amount });
        record.providerPaymentId = invoice.providerPaymentId;
        record.payAddress = invoice.payAddress;
        record.nativeContext = invoice.context || null;
        // Real on-chain payment, always — there is no "sandbox" invoice mode
        // for a wallet address (see lib/payments/index.js's sandboxEnabled).
        record.sandbox = false;
      } else {
        // No crypto provider configured on this server. Only allow local
        // simulation when the server explicitly permits it; otherwise there
        // is no way to fund a wallet and we say so instead of silently
        // enabling free credits.
        record.sandbox = payments.allowSimulate();
      }

      await paymentStore.save(record);
      res.json({
        orderId,
        amount,
        payUrl: record.payUrl || null,
        payAddress: record.payAddress || null,
        sandbox: !!record.sandbox,
        configured: payments.isConfigured(),
      });
    } catch (err) {
      console.error('wallet topup error:', err.message);
      res.status(500).json({ error: 'server', msg: err.message });
    }
  });

  app.get('/api/wallet/topup/:orderId', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      let record = await paymentStore.getByOrderId(req.params.orderId);
      if (!record || record.purpose !== 'deposit' || record.buyerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      // No native provider (TRON, EVM, Solana, UTXO — see
      // lib/payments/index.js's NATIVE_PROVIDERS) has a webhook at all —
      // this poll (driven by the buyer's own top-up page) is the ONLY way a
      // deposit gets credited. Same observed-then-wait-out-the-confirm-window
      // policy as escrow checkout (lib/payment-routes.js's
      // syncProviderPayment) — see lib/payments/native-tron.js's doc comment.
      const nativeTopup = payments.NATIVE_PROVIDERS[record.provider];
      if (record.status !== 'paid' && nativeTopup && record.payAddress) {
        try {
          const seen = await nativeTopup.checkAddressForPayment(record.payAddress, record.amount, record.nativeContext);
          if (seen.found) {
            if (!record.nativeFirstSeenAt) {
              record.nativeFirstSeenAt = new Date();
              record.nativeTxId = seen.txId;
              await paymentStore.save(record);
            }
            const waited = Date.now() - new Date(record.nativeFirstSeenAt).getTime();
            if (waited >= nativeTopup.confirmWindowMs()) {
              record = await creditDeposit(record);
            }
          }
        } catch (e) { /* fall through with current status */ }
      }
      res.json({ orderId: record.orderId, status: record.status, amount: record.amount, sandbox: !!record.sandbox });
    } catch (err) {
      console.error('wallet topup status error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // Complete a sandbox top-up locally when there's no crypto provider to actually
  // confirm a deposit against (dev/demo deployments). Gated the same way the
  // record itself was marked sandbox-eligible, so this can never fund a
  // wallet on a real deployment.
  app.post('/api/wallet/topup/:orderId/simulate', payLimit, async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!payments.allowSimulate()) {
        return res.status(403).json({ error: 'forbidden', msg: 'Simulated payments are not enabled on this server' });
      }
      let record = await paymentStore.getByOrderId(req.params.orderId);
      if (!record || record.purpose !== 'deposit' || record.buyerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      if (!record.sandbox) {
        return res.status(403).json({ error: 'forbidden', msg: 'This top-up is not eligible for simulation' });
      }
      if (record.status !== 'paid') record = await creditDeposit(record);
      res.json({ orderId: record.orderId, status: record.status, amount: record.amount });
    } catch (err) {
      console.error('wallet topup simulate error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/wallet/pay', payLimit, async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const { dealId, listingId, title, variantId } = req.body || {};
      if (!isId(dealId) || !isId(listingId)) {
        return res.status(400).json({ error: 'bad request', msg: 'A listing is required to pay' });
      }

      // Never trust the request body for the seller or the amount — a buyer
      // could name themselves (or any account) as the seller and drain escrow
      // back to themselves, or pay the wrong price. Derive both server-side
      // from the listing, which is the source of truth for who is selling and
      // for how much. Compare with the crypto path, which takes amount+seller
      // from the verified payment record.
      const listing = await sellerStore.getListing(String(listingId));
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
      const sellerEmail = listing.sellerEmail;
      const sellerName = listing.sellerName || '';
      // Multi-price listings (e.g. $10/$50/$100 gift cards on one listing):
      // the price always comes from the listing's own recorded variant, never
      // trusted from the client, exactly like the crypto checkout path.
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
      // Client-supplied titles land on money records (and later in emails and
      // admin views) — cap them like the crypto path does.
      const safeTitle = String(title || listing.title || '').slice(0, 200);
      const displayTitle = variant
        ? `${safeTitle} — ${variant.label}`.slice(0, 220)
        : safeTitle;

      // Auto-delivery listings: atomically reserve the credential unit before
      // debiting, so concurrent buyers can't both pass an out-of-stock check.
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
        const reserved = await stockStore.reserveOne(String(listing._id), String(dealId), user._id, resolvedVariantId);
        if (reserved.empty) {
          return res.status(409).json({ error: 'out_of_stock', msg: 'This item is out of stock' });
        }
        stockReserved = !!reserved.doc;
      }

      // Guard against a crypto-then-wallet double pay: a LIVE (pending or paid)
      // crypto invoice on this deal means money moved or is in flight. Expired /
      // cancelled / refunded records are dead — the deal is repayable.
      if (paymentStore) {
        const prior = await paymentStore.getByOrderId(dealId);
        if (prior && prior.buyerEmail === user._id && prior.provider && prior.provider !== 'wallet') {
          const live = ['pending', 'paid'].includes(prior.status) && !prior.refundStatus;
          if (live) {
            if (stockReserved) {
              try { await stockStore.releaseReservation(String(dealId)); } catch (_) {}
            }
            return res.status(409).json({
              error: 'crypto_pending',
              msg: prior.status === 'paid'
                ? 'This deal was already paid by crypto. Finish the escrow before paying again.'
                : 'This deal already has a pending crypto payment. Complete it or cancel it before paying with Dot Wallet.',
            });
          }
        }
      }

      const result = await walletStore.debitForDeal(user._id, {
        dealId,
        amount: amt,
        lbl: `Escrow hold · ${dealId}`,
      });
      if (result.invalid) {
        if (stockReserved) { try { await stockStore.releaseReservation(String(dealId)); } catch (_) {} }
        return res.status(400).json({ error: 'bad request' });
      }
      if (result.insufficient) {
        if (stockReserved) { try { await stockStore.releaseReservation(String(dealId)); } catch (_) {} }
        const balance = await walletStore.getBalance(user._id);
        return res.status(402).json({ error: 'insufficient', msg: 'Insufficient wallet balance', balance });
      }

      // Record the sale + escrow hold (idempotent). If it was a duplicate
      // charge we still ensure the escrow exists but never debit/count twice.
      const firstCharge = !result.duplicate;
      if (firstCharge && typeof sellerStore.recordSale === 'function') {
        await sellerStore.recordSale(sellerEmail);
      }
      await sellerStore.holdEscrow({
        dealId,
        buyerEmail: user._id,
        sellerEmail,
        amount: amt,
        method: 'wallet',
        title: displayTitle,
      });

      // Persist a payment record so the order surfaces in the seller's
      // "Sales & payments" and the admin payments list. Wallet orders are paid
      // the moment the debit lands (idempotent on orderId, like the escrow).
      if (paymentStore) {
        const fees = sellerStore.calcDealFees(amt, { method: 'wallet' });
        const existing = await paymentStore.getByOrderId(dealId);
        const now = new Date();
        await paymentStore.save({
          _id: existing?._id || crypto.randomBytes(12).toString('hex'),
          orderId: dealId,
          buyerEmail: user._id,
          amount: fees.listingAmount,
          listingAmount: fees.listingAmount,
          buyerTotal: fees.buyerTotal,
          title: displayTitle,
          listingId: String(listingId),
          variantId: resolvedVariantId,
          variantLabel: variant ? variant.label : null,
          sellerEmail,
          sellerName,
          method: 'wallet',
          provider: 'wallet',
          platformFee: fees.platformFee,
          platformFeePercent: fees.platformFeePercent,
          gatewayFee: 0,
          gatewayFeePercent: 0,
          gatewayFeePaidBy: null,
          sellerNet: fees.sellerNet,
          merchantNet: fees.merchantNet,
          status: 'paid',
          createdAt: existing?.createdAt || now,
          paidAt: existing?.paidAt || now,
        });
      }

      // Auto-deliver a stocked credential for this paid order (no-op for
      // manual-delivery listings). Idempotent via claimOne's orderId check.
      // Emails fire only on the first real charge, not on a duplicate re-call.
      const delivery = await autoDeliver({
        paymentStore, sellerStore, stockStore, orderId: dealId,
        onDelivered: firstCharge ? notify.notifyCredential : undefined,
      });
      if (firstCharge && paymentStore) {
        const paid = await paymentStore.getByOrderId(dealId);
        if (paid) notify.notifyPaid(paid);
      }

      res.json({
        wallet: walletStore.serialize(result.wallet),
        duplicate: !!result.duplicate,
        delivered: !!delivery.delivered,
        outOfStock: !!delivery.outOfStock,
      });
    } catch (err) {
      console.error('wallet pay error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });
}

module.exports = { registerWalletRoutes };
