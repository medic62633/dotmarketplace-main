const crypto = require('crypto');
const path = require('path');
const { saveListingImage, isListingImageUrl, deleteListingImageFile } = require('./image-upload');
const { sanitizeVariants } = require('./seller-store');
const { isId } = require('./validate');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MAX_LISTING_IMAGES = 6;

/* Gallery of up to MAX_LISTING_IMAGES photos per listing. `images` is the
 * ordered list of EXISTING image URLs the seller kept — validated via
 * isListingImageUrl AND checked against the listing's own prior set, so a
 * seller can never point a listing at another seller's uploaded file just
 * by naming its URL. `imagesData` is the ordered list of NEW photos (data
 * URLs) to upload and append after the kept ones. Anything from the prior
 * set that isn't in the final result is deleted from disk — same cleanup
 * discipline the old single-image flow had. `doc.image` (the singular cover
 * field every thumbnail/card view still reads) stays in sync as the new
 * array's first entry, so nothing else in the app needs to change. */
function applyListingImages(doc, { images, imagesData } = {}, ownerKey) {
  const before = Array.isArray(doc.images) && doc.images.length
    ? doc.images
    : (doc.image ? [doc.image] : []);

  const keepList = Array.isArray(images) ? images : [];
  const kept = keepList.filter(u => typeof u === 'string' && isListingImageUrl(u) && before.includes(u));

  const uploads = Array.isArray(imagesData) ? imagesData : [];
  const uploaded = [];
  for (const dataUrl of uploads) {
    if (kept.length + uploaded.length >= MAX_LISTING_IMAGES) break;
    uploaded.push(saveListingImage(dataUrl, PUBLIC_DIR, ownerKey));
  }

  const next = [...kept, ...uploaded].slice(0, MAX_LISTING_IMAGES);
  const nextSet = new Set(next);
  for (const url of before) {
    if (!nextSet.has(url)) deleteListingImageFile(url, PUBLIC_DIR);
  }

  doc.images = next;
  doc.image = next[0] || null;
}
function userPayload(user, sellerProfile) {
  const hasProfile = !!sellerProfile;
  return {
    name: user.name,
    email: user._id,
    isSeller: !!user.isSeller || hasProfile,
    isAdmin: !!user.isAdmin || user._id === (process.env.ADMIN_EMAIL || 'admin@dot.market').toLowerCase(),
    emailVerified: !!user.emailVerified,
    seller: sellerProfile || null,
  };
}

const { formatPayMethod } = require('./payment-labels');
const { isValidCategory } = require('./categories');

/* USDT TRC-20 addresses are base58check, 34 chars, starting with 'T'. */
const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
function isTrc20Address(addr) {
  return typeof addr === 'string' && TRC20_RE.test(addr);
}

function registerSellerRoutes(app, { authUser, store, sellerStore, sellerEmailFromName, paymentStore, walletStore, writeLimiter, readLimiter }) {
  const writeLimit = writeLimiter || ((req, res, next) => next());
  const readLimit = readLimiter || ((req, res, next) => next());
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
    // A revoked seller (profile exists but is no longer verified, or the role
    // was stripped) is locked out even if their session token is still valid.
    if (profile && !profile.verified) {
      res.status(403).json({ error: 'forbidden', msg: 'Seller access revoked — contact an administrator' });
      return null;
    }
    if (!user.isSeller && !profile) {
      res.status(403).json({ error: 'forbidden', msg: 'Seller account required' });
      return null;
    }
    if (!user.isSeller && profile) {
      user.isSeller = true;
      await store.putUser(user);
    }
    return user;
  }

  app.get('/api/me', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      let seller = null;
      const profile = await sellerStore.getSellerProfile(user._id);
      if (user.isSeller || profile) seller = sellerStore.serializeSellerProfile(profile);
      res.json({ user: userPayload(user, seller) });
    } catch (err) {
      console.error('me error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Fetch the distinct seller profiles for a set of listings in ONE query —
   * the old per-listing getSellerProfile loop was an N+1 on a public,
   * unauthenticated endpoint (a cheap CPU/DoS amplifier). */
  async function profilesByEmail(docs) {
    const emails = [...new Set(docs.map(d => d.sellerEmail).filter(Boolean))];
    const map = new Map();
    await Promise.all(emails.map(async em => {
      map.set(em, await sellerStore.getSellerProfile(em));
    }));
    return map;
  }

  app.get('/api/listings', readLimit, async (req, res) => {
    try {
      const docs = await sellerStore.listPublicListings();
      const profiles = await profilesByEmail(docs);
      const out = [];
      for (const doc of docs) {
        const sp = profiles.get(doc.sellerEmail);
        if (!sp?.verified) continue;
        out.push(sellerStore.serializeListing(doc, sp));
      }
      res.json({ listings: out });
    } catch (err) {
      console.error('list listings error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* #9 Backend search/filter/sort/paginate. Keeps verified-seller gating server-side. */
  app.get('/api/listings/search', readLimit, async (req, res) => {
    try {
      const { q, cat, min, max, sort, page, pageSize } = req.query || {};
      // searchListings already gates to verified sellers BEFORE paginating, so
      // `total`/`pages` match what buyers see (no more lying pager).
      const result = await sellerStore.searchListings({ q, cat, min, max, sort, page, pageSize, verifiedOnly: true });
      const profiles = await profilesByEmail(result.items);
      const out = [];
      for (const doc of result.items) {
        out.push(sellerStore.serializeListing(doc, profiles.get(doc.sellerEmail)));
      }
      res.json({ listings: out, total: result.total, page: result.page, pages: result.pages, pageSize: result.pageSize });
    } catch (err) {
      console.error('listings search error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/sellers/:id/profile', readLimit, async (req, res) => {
    try {
      const id = decodeURIComponent(req.params.id || '').trim().toLowerCase();
      const profile = id.includes('@')
        ? await sellerStore.getPublicSellerProfile(id)
        : await sellerStore.getPublicSellerProfileBySlug(id);
      if (!profile) return res.status(404).json({ error: 'not found', msg: 'Seller not found or not verified' });
      res.json({ profile });
    } catch (err) {
      console.error('seller profile error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/reviews', writeLimit, async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const { dealId, rating, text } = req.body || {};
      if (!dealId) return res.status(400).json({ error: 'dealId', msg: 'Deal ID required' });
      const result = await sellerStore.addReview({
        dealId: String(dealId).trim(),
        buyerEmail: user._id,
        buyerName: user.name,
        rating,
        text,
      });
      if (result.notEligible) return res.status(400).json({ error: 'not eligible', msg: 'You can only review completed deals' });
      if (result.forbidden) return res.status(403).json({ error: 'forbidden' });
      if (result.duplicate) return res.status(409).json({ error: 'duplicate', msg: 'You already reviewed this deal' });
      res.json({ ok: true, review: result.review });
    } catch (err) {
      console.error('add review error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/community/sellers', readLimit, async (req, res) => {
    try {
      const profiles = await sellerStore.listSellerProfiles();
      const listings = await sellerStore.listPublicListings();
      const listingCount = {};
      for (const l of listings) {
        listingCount[l.sellerEmail] = (listingCount[l.sellerEmail] || 0) + 1;
      }
      const sellers = profiles
        .map(p => ({
          name: p.name || String(p._id).split('@')[0],
          deals: p.sales ?? p.deals ?? 0,
          rate: p.rate ?? 5,
          verified: !!p.verified,
          since: p.since || '',
          listings: listingCount[p._id] || 0,
        }))
        .sort((a, b) => b.deals - a.deals || b.rate - a.rate || b.listings - a.listings);
      const totalDeals = sellers.reduce((sum, s) => sum + s.deals, 0);
      res.json({
        sellers,
        stats: {
          sellers: sellers.length,
          verifiedSellers: sellers.filter(s => s.verified).length,
          totalDeals,
          listings: listings.length,
        },
      });
    } catch (err) {
      console.error('community sellers error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Public self-signup as a seller is DISABLED. Sellers are provisioned by an
   * admin through a one-time invite link (see /api/admin/seller-invites +
   * /api/seller-invite/claim). This endpoint only reports an existing seller
   * account; it can no longer grant the seller role. */
  app.post('/api/seller/apply', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (user.isSeller) {
        const profile = await sellerStore.getSellerProfile(user._id);
        return res.json({ user: userPayload(user, sellerStore.serializeSellerProfile(profile)) });
      }
      return res.status(403).json({
        error: 'invite_required',
        msg: 'Seller accounts are created by invitation only. Ask an administrator for a setup link.',
      });
    } catch (err) {
      console.error('seller apply error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/seller/dashboard', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const profile = await sellerStore.getSellerProfile(user._id);
      const listings = await sellerStore.listSellerListings(user._id);
      const withdrawals = await sellerStore.listWithdrawals(user._id);
      res.json({
        profile: sellerStore.serializeSellerProfile(profile),
        stats: {
          activeListings: listings.filter(l => l.status === 'active').length,
          draftListings: listings.filter(l => l.status === 'draft').length,
          pendingWithdrawals: withdrawals.filter(w => w.status === 'pending').length,
        },
      });
    } catch (err) {
      console.error('seller dashboard error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/seller/listings', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const docs = await sellerStore.listSellerListings(user._id);
      const profile = await sellerStore.getSellerProfile(user._id);
      res.json({
        listings: docs.map(d => sellerStore.serializeListing(d, profile)),
      });
    } catch (err) {
      console.error('seller listings error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/seller/listings', writeLimit, async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const profile = await sellerStore.getSellerProfile(user._id);
      const { cat, title, desc, price, variants: rawVariants, status, images, imagesData } = req.body || {};
      const wantActive = status === 'active';
      if (wantActive && !profile?.verified) {
        return res.status(403).json({ error: 'unverified', msg: 'Publish after admin verification' });
      }
      if (!cat || !title || !desc) {
        return res.status(400).json({ error: 'fields', msg: 'Category, title and description required' });
      }
      if (!isValidCategory(cat)) {
        return res.status(400).json({ error: 'cat', msg: 'Invalid category' });
      }
      // Multiple price options on one listing (e.g. $10/$50/$100 gift cards) —
      // the buyer picks one at checkout. Falls back to the flat price field
      // when the seller isn't using variants.
      const variants = sanitizeVariants(rawVariants);
      let amt;
      if (variants.length) {
        amt = Math.min(...variants.map(v => v.price));
      } else {
        amt = parseFloat(price);
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({ error: 'price', msg: 'Enter a valid price' });
        }
      }
      const id = 'L-' + crypto.randomBytes(4).toString('hex');
      const doc = {
        _id: id,
        sellerEmail: user._id,
        sellerName: user.name,
        cat: String(cat).slice(0, 32),
        title: String(title).slice(0, 200),
        desc: String(desc).slice(0, 4000),
        price: Math.round(amt * 100) / 100,
        variants,
        status: wantActive ? 'active' : 'draft',
        ageDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      try {
        applyListingImages(doc, { images, imagesData }, user._id.replace(/[^a-z0-9]/gi, ''));
      } catch (imgErr) {
        return res.status(400).json({ error: 'image', msg: imgErr.message === 'too large' ? 'Image too large (max 4 MB)' : imgErr.message === 'storage_limit' ? 'Image storage limit reached (20 MB) — remove old images' : 'Invalid image' });
      }
      await sellerStore.saveListing(doc);
      res.json({ listing: sellerStore.serializeListing(doc, profile) });
    } catch (err) {
      console.error('create listing error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.put('/api/seller/listings/:id', writeLimit, async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const doc = await sellerStore.getListing(req.params.id);
      if (!doc || doc.sellerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      const { cat, title, desc, price, variants: rawVariants, status, images, imagesData } = req.body || {};
      if (cat) {
        if (!isValidCategory(cat)) {
          return res.status(400).json({ error: 'cat', msg: 'Invalid category' });
        }
        doc.cat = String(cat).slice(0, 32);
      }
      if (title) doc.title = String(title).slice(0, 200);
      if (desc) doc.desc = String(desc).slice(0, 4000);
      // Reuse existing variant ids (matched by id, then by label) so stock
      // already attached to a variant survives an edit that doesn't touch it.
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'variants')) {
        const variants = sanitizeVariants(rawVariants, doc.variants);
        doc.variants = variants;
        if (variants.length) {
          doc.price = Math.round(Math.min(...variants.map(v => v.price)) * 100) / 100;
        }
      }
      if (price != null && !(doc.variants || []).length) {
        const amt = parseFloat(price);
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({ error: 'price', msg: 'Enter a valid price' });
        }
        doc.price = Math.round(amt * 100) / 100;
      }
      if (status && ['active', 'draft', 'paused'].includes(status)) {
        if (status === 'active') {
          const profile = await sellerStore.getSellerProfile(user._id);
          if (!profile?.verified) {
            return res.status(403).json({ error: 'unverified', msg: 'Publish after admin verification' });
          }
        }
        doc.status = status;
      }
      try {
        // Only touch the gallery when the request actually carries image
        // fields — a PUT that's just toggling status/price must not treat
        // "no images key sent" as "seller wants every photo removed".
        if (imagesData?.length || Object.prototype.hasOwnProperty.call(req.body || {}, 'images')) {
          applyListingImages(doc, { images, imagesData }, user._id.replace(/[^a-z0-9]/gi, ''));
        }
      } catch (imgErr) {
        return res.status(400).json({ error: 'image', msg: imgErr.message === 'too large' ? 'Image too large (max 4 MB)' : imgErr.message === 'storage_limit' ? 'Image storage limit reached (20 MB) — remove old images' : 'Invalid image' });
      }
      await sellerStore.saveListing(doc);
      const profile = await sellerStore.getSellerProfile(user._id);
      res.json({ listing: sellerStore.serializeListing(doc, profile) });
    } catch (err) {
      console.error('update listing error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.delete('/api/seller/listings/:id', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const doc = await sellerStore.getListing(req.params.id);
      if (!doc || doc.sellerEmail !== user._id) {
        return res.status(404).json({ error: 'not found' });
      }
      const gallery = Array.isArray(doc.images) && doc.images.length ? doc.images : (doc.image ? [doc.image] : []);
      for (const url of gallery) deleteListingImageFile(url, PUBLIC_DIR);
      doc.image = null;
      doc.images = [];
      doc.status = 'removed';
      await sellerStore.saveListing(doc);
      res.json({ ok: true });
    } catch (err) {
      console.error('delete listing error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.put('/api/seller/withdraw-address', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const address = String((req.body || {}).address || '').trim();
      if (!isTrc20Address(address)) {
        return res.status(400).json({ error: 'address', msg: 'Enter a valid USDT TRC-20 address' });
      }
      const profile = await sellerStore.ensureSellerProfile(user._id, user.name);
      profile.withdrawAddress = address.slice(0, 120);
      await sellerStore.saveSellerProfile(profile);
      res.json({ profile: sellerStore.serializeSellerProfile(profile) });
    } catch (err) {
      console.error('withdraw address error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/seller/withdrawals', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const list = await sellerStore.listWithdrawals(user._id);
      res.json({
        withdrawals: list.map(w => ({
          id: w._id,
          amount: w.amount,
          address: w.address,
          network: w.network,
          status: w.status,
          txHash: w.txHash || null,
          createdAt: w.createdAt,
        })),
      });
    } catch (err) {
      console.error('list withdrawals error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/seller/withdrawals', writeLimit, async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const amount = parseFloat((req.body || {}).amount);
      const address = String((req.body || {}).address || '').trim();
      if (!Number.isFinite(amount) || amount < 10) {
        return res.status(400).json({ error: 'amount', msg: 'Minimum withdrawal is 10 USDT' });
      }
      const existing = await sellerStore.getSellerProfile(user._id);
      if (!existing) return res.status(404).json({ error: 'profile' });
      if (address && !isTrc20Address(address)) {
        return res.status(400).json({ error: 'address', msg: 'Enter a valid USDT TRC-20 address' });
      }
      const payoutAddress = address || existing.withdrawAddress;
      if (!payoutAddress || !isTrc20Address(payoutAddress)) {
        return res.status(400).json({ error: 'address', msg: 'Set a valid USDT TRC-20 withdrawal address first' });
      }
      const rounded = Math.round(amount * 100) / 100;
      const ledgerEntry = {
        type: 'withdraw',
        amt: -rounded,
        lbl: `Withdrawal · ${payoutAddress.slice(0, 8)}…`,
        t: 'just now',
        at: new Date(),
      };
      // Atomic conditional debit — concurrent withdrawals/payouts can't overdraw.
      const result = await sellerStore.debitSellerBalance(user._id, rounded, ledgerEntry);
      if (result.notFound) return res.status(404).json({ error: 'profile' });
      if (result.invalid) return res.status(400).json({ error: 'amount', msg: 'Enter a valid amount' });
      if (result.insufficient) {
        return res.status(400).json({ error: 'amount', msg: `Insufficient balance — you have ${result.balance.toFixed(2)} USDT` });
      }
      const profile = result.profile;
      const withdrawal = {
        _id: crypto.randomBytes(8).toString('hex'),
        sellerEmail: user._id,
        amount: rounded,
        address: payoutAddress,
        network: 'TRC-20',
        status: 'pending',
        createdAt: new Date(),
      };
      try {
        await sellerStore.saveWithdrawal(withdrawal);
      } catch (saveErr) {
        await sellerStore.creditSellerBalance(user._id, rounded, {
          type: 'refund',
          amt: rounded,
          lbl: 'Withdrawal failed — funds returned',
          t: 'just now',
          at: new Date(),
        });
        throw saveErr;
      }
      if (address) {
        profile.withdrawAddress = address.slice(0, 120);
        await sellerStore.saveSellerProfile(profile);
      }
      res.json({
        withdrawal: {
          id: withdrawal._id,
          amount: withdrawal.amount,
          address: withdrawal.address,
          network: withdrawal.network,
          status: withdrawal.status,
          createdAt: withdrawal.createdAt,
        },
        profile: sellerStore.serializeSellerProfile(profile),
      });
    } catch (err) {
      console.error('withdraw error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/seller/orders', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const orders = paymentStore
        ? await paymentStore.listBySeller(user._id, 50)
        : [];
      res.json({
        orders: orders.map(o => ({
          orderId: o.orderId,
          title: o.title,
          amount: o.amount,
          buyerTotal: o.buyerTotal ?? o.amount,
          status: o.status,
          refundStatus: o.refundStatus || null,
          outOfStock: !!o.outOfStock,
          method: o.method,
          methodLabel: formatPayMethod(o),
          payNetwork: o.payNetwork || null,
          buyerEmail: o.buyerEmail,
          listingId: o.listingId,
          paidAt: o.paidAt || null,
          createdAt: o.createdAt,
        })),
      });
    } catch (err) {
      console.error('seller orders error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Escrows for this seller — drives the "mark delivered" UI. */
  app.get('/api/seller/escrows', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const escrows = await sellerStore.listSellerEscrows(user._id, 100);
      res.json({
        escrows: escrows.map(e => ({
          dealId: e._id,
          title: e.title || '',
          amount: e.amount,
          status: e.status,
          buyerEmail: e.buyerEmail || null,
          method: e.method || null,
          createdAt: e.createdAt || null,
          deliveredAt: e.deliveredAt || null,
          deliveryProof: e.deliveryProof || null,
          disputedAt: e.disputedAt || null,
          disputeReason: e.disputeReason || null,
        })),
      });
    } catch (err) {
      console.error('seller escrows error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* #16 Buyer order history — purchases + their escrow/delivery state. */
  app.get('/api/buyer/orders', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const payments = paymentStore ? await paymentStore.listByBuyer(user._id, 100) : [];
      const out = [];
      for (const p of payments) {
        if (p.purpose === 'deposit') continue; // wallet top-ups aren't orders
        const escrow = await sellerStore.getEscrow(p.orderId);
        out.push({
          orderId: p.orderId,
          title: p.title,
          amount: p.amount,
          buyerTotal: p.buyerTotal ?? p.amount,
          status: p.status,
          refundStatus: p.refundStatus || null,
          method: p.method,
          methodLabel: formatPayMethod(p),
          sellerEmail: p.sellerEmail,
          sellerName: p.sellerName,
          listingId: p.listingId,
          escrowStatus: escrow ? escrow.status : null,
          deliveredAt: escrow?.deliveredAt || null,
          paidAt: p.paidAt || null,
          createdAt: p.createdAt,
        });
      }
      res.json({ orders: out });
    } catch (err) {
      console.error('buyer orders error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* #17 Seller analytics — earnings, sales, listing & conversion metrics. */
  app.get('/api/seller/analytics', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const profile = await sellerStore.getSellerProfile(user._id);
      const listings = await sellerStore.listSellerListings(user._id);
      const orders = paymentStore ? await paymentStore.listBySeller(user._id, 500) : [];
      const paid = orders.filter(o => o.status === 'paid');
      const gross = paid.reduce((s, o) => s + (o.amount || 0), 0);
      const fees = paid.reduce((s, o) => s + (o.platformFee || 0), 0);
      const byMethod = {};
      for (const o of paid) {
        const m = o.method || 'unknown';
        byMethod[m] = (byMethod[m] || 0) + 1;
      }
      // 30-day earnings series for a sparkline.
      const days = 30;
      const series = Array.from({ length: days }, () => 0);
      const now = Date.now();
      for (const o of paid) {
        const t = new Date(o.paidAt || o.createdAt).getTime();
        const d = Math.floor((now - t) / 86400000);
        if (d >= 0 && d < days) series[days - 1 - d] += (o.sellerNet ?? o.amount ?? 0);
      }
      const ledger = (profile?.ledger || []);
      const payoutCount = ledger.filter(e => e.type === 'payout').length;
      res.json({
        balance: profile?.balance || 0,
        pendingEscrow: profile?.pendingEscrow || 0,
        totalEarnings: profile?.totalEarnings || 0,
        deals: profile?.deals || 0,
        rating: profile?.rate ?? 5,
        listings: {
          total: listings.length,
          active: listings.filter(l => l.status === 'active').length,
          draft: listings.filter(l => l.status === 'draft').length,
          paused: listings.filter(l => l.status === 'paused').length,
        },
        sales: {
          count: paid.length,
          gross: Math.round(gross * 100) / 100,
          platformFees: Math.round(fees * 100) / 100,
          avgOrder: paid.length ? Math.round((gross / paid.length) * 100) / 100 : 0,
          byMethod,
        },
        payoutCount,
        earnings30d: series.map(v => Math.round(v * 100) / 100),
      });
    } catch (err) {
      console.error('seller analytics error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/seller/escrow-hold', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const { dealId, amount, sellerEmail, listingTitle, method: rawMethod } = req.body || {};
      const amt = parseFloat(amount);
      if (!isId(dealId) || !sellerEmail || !Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'bad request' });
      }
      // Whitelist the funding method. The method is recorded on the escrow and
      // later drives resolveEscrow's refund branch (wallet refund releases the
      // wallet hold; crypto does not), so a mislabeled/arbitrary value would
      // break refund handling and payout labels.
      const ALLOWED_METHODS = ['wallet', 'trc20', 'bep20', 'ton', 'card'];
      const method = ALLOWED_METHODS.includes(rawMethod) ? rawMethod : null;

      let holdAmount = amt;
      let holdSeller = sellerEmail;
      if (method === 'wallet') {
        // Wallet escrow must be backed by a hold on the buyer's wallet. The
        // amount comes from the payment record when available; otherwise from
        // the wallet's DURABLE holds list ({ dealId, amt }) — never the capped
        // 200-entry ledger, whose hold entry can be gone by the time a legacy
        // deal opens its escrow.
        if (!walletStore || !(await walletStore.hasHold(user._id, dealId))) {
          return res.status(403).json({ error: 'forbidden', msg: 'Wallet payment not found for this deal' });
        }
        const payment = paymentStore ? await paymentStore.getByOrderId(dealId) : null;
        if (payment && payment.buyerEmail === user._id && payment.status === 'paid') {
          holdAmount = payment.amount;
          holdSeller = payment.sellerEmail || sellerEmail;
        } else if (typeof walletStore.getHold === 'function') {
          const hold = await walletStore.getHold(user._id, dealId);
          holdAmount = hold?.amt || 0;
        } else {
          const wallet = await walletStore.getWallet(user._id);
          const debit = (wallet?.ledger || []).find(e => e.type === 'hold' && e.dealId === dealId);
          holdAmount = debit ? Math.abs(Number(debit.amt) || 0) : 0;
        }
        if (holdAmount <= 0) {
          return res.status(403).json({ error: 'forbidden', msg: 'Wallet payment not found for this deal' });
        }
      } else {
        // Crypto escrow must be backed by a confirmed payment owned by this
        // buyer. Amount + seller are taken from the payment record, never the
        // request body. (Crypto payments are already held at markPaid time, so
        // this call is idempotent via holdEscrow.)
        const payment = paymentStore ? await paymentStore.getByOrderId(dealId) : null;
        if (!payment || payment.buyerEmail !== user._id || payment.status !== 'paid') {
          return res.status(403).json({ error: 'forbidden', msg: 'Payment not confirmed' });
        }
        if (payment.sellerEmail && payment.sellerEmail !== sellerEmail) {
          return res.status(400).json({ error: 'bad request', msg: 'Seller mismatch' });
        }
        holdAmount = payment.amount;
        holdSeller = payment.sellerEmail || sellerEmail;
      }

      await sellerStore.holdEscrow({
        dealId,
        buyerEmail: user._id,
        sellerEmail: holdSeller,
        amount: holdAmount,
        method: method || null,
        title: String(listingTitle || '').slice(0, 200),
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('escrow hold error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Seller marks a deal delivered (with proof the buyer/arbiter can review). */
  app.post('/api/seller/deliver', async (req, res) => {
    try {
      const user = await requireSeller(req, res);
      if (!user) return;
      const { dealId, proof } = req.body || {};
      if (!dealId) return res.status(400).json({ error: 'bad request' });
      const result = await sellerStore.markDelivered({ dealId: String(dealId).trim(), sellerEmail: user._id, proof });
      if (result.notFound) return res.status(404).json({ error: 'not found', msg: 'No escrow found for this deal' });
      if (result.forbidden) return res.status(403).json({ error: 'forbidden' });
      if (result.badState) return res.status(409).json({ error: 'bad_state', msg: `Escrow is ${result.status} — cannot mark delivered` });
      res.json({ ok: true, escrow: { id: result.escrow._id, status: result.escrow.status, deliveredAt: result.escrow.deliveredAt } });
    } catch (err) {
      console.error('deliver error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* Buyer opens a dispute on a held/delivered escrow. */
  app.post('/api/seller/dispute', async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const { dealId, reason } = req.body || {};
      if (!dealId) return res.status(400).json({ error: 'bad request' });
      if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason', msg: 'Tell the arbiter what went wrong' });
      const result = await sellerStore.openDispute({ dealId: String(dealId).trim(), buyerEmail: user._id, reason });
      if (result.notFound) return res.status(404).json({ error: 'not found', msg: 'No escrow found for this deal' });
      if (result.forbidden) return res.status(403).json({ error: 'forbidden' });
      if (result.badState) return res.status(409).json({ error: 'bad_state', msg: `Escrow is ${result.status} — cannot dispute` });
      res.json({ ok: true, escrow: { id: result.escrow._id, status: result.escrow.status, disputedAt: result.escrow.disputedAt } });
    } catch (err) {
      console.error('dispute error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/seller/payout', writeLimit, async (req, res) => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const { dealId } = req.body || {};
      if (!dealId) {
        return res.status(400).json({ error: 'bad request' });
      }
      // Release the recorded escrow — amount + seller come from the escrow, and
      // only the buyer who funded it may confirm delivery.
      const result = await sellerStore.creditSellerPayout({ dealId, buyerEmail: user._id });
      if (result.notFound) {
        return res.status(404).json({ error: 'not found', msg: 'No escrow found for this deal' });
      }
      if (result.forbidden) {
        return res.status(403).json({ error: 'forbidden', msg: 'Only the buyer can release this escrow' });
      }
      if (result.duplicate) {
        return res.json({ ok: true, duplicate: true });
      }
      res.json({ ok: true, net: result.net, fee: result.fee, profile: sellerStore.serializeSellerProfile(result.profile) });
    } catch (err) {
      console.error('payout error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  return { userPayload };
}

module.exports = { registerSellerRoutes, userPayload };
