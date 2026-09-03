/* HTTP routes for credential stock: sellers stock encrypted credentials on a
 * listing; an authenticated buyer reveals the single credential their paid
 * order claimed. Decryption happens only here, server-side, after auth checks. */
const { autoDeliver } = require('./stock-deliver');

function registerStockRoutes(app, { authUser, sellerStore, paymentStore, stockStore, writeLimiter }) {
  const writeLimit = writeLimiter || ((req, res, next) => next());

  async function requireAuth(req, res) {
    const user = await authUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    return user;
  }

  async function requireSeller(req, res) {
    const user = await requireAuth(req, res);
    if (!user) return null;
    const profile = await sellerStore.getSellerProfile(user._id);
    if (profile && !profile.verified) {
      res.status(403).json({ error: 'forbidden', msg: 'Seller access revoked — contact an administrator' });
      return null;
    }
    if (!user.isSeller && !profile) {
      res.status(403).json({ error: 'forbidden', msg: 'Seller account required' });
      return null;
    }
    return user;
  }

  /* Resolve/validate an optional variantId against a listing's own variant
   * list. Returns { ok:true, variantId } (null when the listing has no
   * variants) or { ok:false } when the listing HAS variants but none/an
   * invalid one was named — a variant-based listing's stock always belongs
   * to exactly one denomination, never the listing as a whole. */
  function resolveVariant(listing, variantId) {
    const variants = Array.isArray(listing.variants) ? listing.variants : [];
    if (!variants.length) return { ok: true, variantId: null };
    const v = variants.find(x => x.id === String(variantId || ''));
    return v ? { ok: true, variantId: v.id } : { ok: false };
  }

  /* Stock credentials on a listing (or, for a multi-price listing, one of its
   * variants — e.g. the $50 gift-card denomination) the caller owns. Accepts
   * { secrets: [] } or { text } with one credential per line, plus an
   * optional { variantId }. Never echoes secrets back. */
  app.post('/api/seller/listings/:id/stock', writeLimit, async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const listing = await sellerStore.getListing(req.params.id);
      if (!listing || listing.sellerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      const resolved = resolveVariant(listing, (req.body || {}).variantId);
      if (!resolved.ok) {
        return res.status(400).json({ error: 'variant', msg: 'Choose which price option this stock is for' });
      }
      let secrets = [];
      if (Array.isArray((req.body || {}).secrets)) secrets = req.body.secrets;
      else if (typeof (req.body || {}).text === 'string') secrets = req.body.text.split(/\r?\n/);
      if (!secrets.length) {
        return res.status(400).json({ error: 'secrets', msg: 'Provide credentials (one per line)' });
      }
      const result = await stockStore.addStock(listing._id, user._id, secrets, resolved.variantId);
      res.json({ ok: true, added: result.added, available: result.available, variantId: resolved.variantId });
    } catch (err) {
      console.error('add stock error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Available-unit count for the seller's own listing (drives the stock UI).
   * A classic single-price listing returns { available }. A multi-price
   * listing returns a per-variant breakdown instead, since each denomination
   * has its own separate stock pool. */
  app.get('/api/seller/listings/:id/stock-count', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const listing = await sellerStore.getListing(req.params.id);
      if (!listing || listing.sellerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      const variants = Array.isArray(listing.variants) ? listing.variants : [];
      if (variants.length) {
        const counts = await Promise.all(variants.map(v => stockStore.countAvailable(listing._id, v.id)));
        return res.json({
          variants: variants.map((v, i) => ({ id: v.id, label: v.label, available: counts[i] })),
        });
      }
      const available = await stockStore.countAvailable(listing._id);
      res.json({ available });
    } catch (err) {
      console.error('stock count error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Reveal the credential a paid order claimed. Re-authorizes every call:
   * authenticated + recorded buyer + payment actually paid. Read-only/idempotent. */
  app.get('/api/buyer/orders/:orderId/credential', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const orderId = String(req.params.orderId || '');
      const payment = await paymentStore.getByOrderId(orderId);
      if (!payment || payment.buyerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      // A refunded order keeps status 'paid' (only refundStatus is added) —
      // without this check a refunded buyer would keep reading the delivered
      // credential forever.
      if (payment.refundStatus) {
        return res.status(410).json({ error: 'refunded', msg: 'This order was refunded — the credential is no longer available' });
      }
      if (payment.status !== 'paid') {
        return res.status(409).json({ error: 'unpaid', msg: 'Payment is not confirmed yet' });
      }
      const rec = await stockStore.getForOrder(orderId);
      if (!rec) {
        return res.status(404).json({ error: 'no_credential', msg: 'No credential is attached to this order' });
      }
      let credential = null;
      try {
        credential = stockStore.reveal(rec);
      } catch (err) {
        console.error('credential decrypt error:', err.message);
        return res.status(500).json({ error: 'server' });
      }
      res.json({ orderId, credential });
    } catch (err) {
      console.error('reveal credential error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });
}

module.exports = { registerStockRoutes };
