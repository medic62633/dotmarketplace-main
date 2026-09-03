const crypto = require('crypto');
const { calcDealFees, feeConfig } = require('./fees');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function defaultSellerProfile(email, name) {
  const since = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return {
    _id: email,
    name: name || email.split('@')[0],
    verified: false,
    verifiedAt: null,
    balance: 0,
    pendingEscrow: 0,
    totalEarnings: 0,
    deals: 0,
    rate: 5,
    since,
    withdrawAddress: '',
    ledger: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const MAX_VARIANTS = 24;
const MAX_VARIANT_LABEL_LEN = 60;

/**
 * Sanitize a client-supplied variant list for a listing (e.g. gift-card
 * denominations: "$10" / "$50" / "$100" each with their own price on one
 * listing, instead of one listing per amount).
 *
 * Reuses the id of an existing variant when the client echoes it back
 * (matched by id, falling back to a same-label match for older clients that
 * don't round-trip ids) so credential stock already attached to that variant
 * isn't orphaned by an edit; any new row gets a fresh id. Returns [] for no
 * variants (classic single-price listing — unchanged behavior).
 */
function sanitizeVariants(raw, existingVariants) {
  const list = Array.isArray(raw) ? raw : [];
  const existingById = new Map((existingVariants || []).map(v => [v.id, v]));
  const existingByLabel = new Map((existingVariants || []).map(v => [v.label, v]));
  const usedIds = new Set();
  const out = [];
  for (const v of list) {
    const label = String(v?.label ?? '').trim().slice(0, MAX_VARIANT_LABEL_LEN);
    const price = round2(parseFloat(v?.price));
    if (!label || !Number.isFinite(price) || price <= 0) continue;
    let id = null;
    const byId = v?.id && existingById.get(String(v.id));
    if (byId && !usedIds.has(byId.id)) id = byId.id;
    if (!id) {
      const byLabel = existingByLabel.get(label);
      if (byLabel && !usedIds.has(byLabel.id)) id = byLabel.id;
    }
    if (!id) id = crypto.randomBytes(6).toString('hex');
    usedIds.add(id);
    out.push({ id, label, price });
    if (out.length >= MAX_VARIANTS) break;
  }
  return out;
}

function serializeListing(doc, sellerProfile) {
  const sp = sellerProfile || {};
  const variants = Array.isArray(doc.variants) ? doc.variants : [];
  return {
    id: doc._id,
    cat: doc.cat,
    title: doc.title,
    desc: doc.desc,
    price: doc.price,
    variants,
    age: doc.ageDays || 0,
    status: doc.status,
    sellerEmail: doc.sellerEmail,
    seller: {
      // Prefer the live profile name — the listing's sellerName snapshot goes
      // stale when the seller renames (e.g. invite claim) after publishing.
      name: sp.name || doc.sellerName || 'Seller',
      rate: sp.rate ?? 5,
      deals: sp.sales ?? sp.deals ?? 0,
      vfy: !!sp.verified,
      since: sp.since || '',
    },
    createdAt: doc.createdAt,
    image: doc.image || null,
  };
}

function createSellerStore({ memory, listingsCol, sellerProfilesCol, withdrawalsCol, escrowsCol, reviewsCol }) {
  /* Per-key promise chains serialize check-then-act sequences in the memory
   * store (the wallet-store withLock pattern). holdEscrow / creditSellerPayout /
   * resolveEscrow all span multiple awaits, and the event loop interleaves
   * concurrent calls — without this, two first-time holds for the same deal can
   * both pass the "already exists?" check, and tests expect the memory store to
   * behave like Mongo. */
  const _locks = new Map();
  function withLock(key, fn) {
    const prev = _locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    _locks.set(key, next.catch(() => {}));
    return next;
  }

  async function getListing(id) {
    if (memory) return memory.listings.get(id) || null;
    return listingsCol.findOne({ _id: id });
  }

  async function saveListing(doc) {
    doc.updatedAt = new Date();
    if (memory) {
      memory.listings.set(doc._id, doc);
      return;
    }
    await listingsCol.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }

  async function deleteListing(id) {
    if (memory) return memory.listings.delete(id);
    await listingsCol.deleteOne({ _id: id });
  }

  async function listPublicListings() {
    const filter = { status: 'active' };
    if (memory) {
      return [...memory.listings.values()]
        .filter(l => l.status === 'active')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return listingsCol.find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  }

  /**
   * #9 Backend search / filter / sort / paginate over active listings.
   * opts: { q, cat, min, max, sort ('new'|'price-asc'|'price-desc'), page, pageSize,
   *         verifiedOnly } — when verifiedOnly is true, only listings from
   *         verified sellers are matched, BEFORE pagination, so `total` and the
   *         page slices reflect what buyers actually see (previously the route
   *         filtered unverified sellers after paginating, so the pager lied).
   * Returns { items, total, page, pages, pageSize }.
   */
  async function searchListings(opts = {}) {
    const q = String(opts.q || '').trim().toLowerCase();
    const cat = String(opts.cat || '').trim();
    // Parse each bound once; an unparseable bound is simply ignored (treated as
    // no limit) rather than NaN-poisoning the comparison.
    const minRaw = parseFloat(opts.min);
    const maxRaw = parseFloat(opts.max);
    const min = Number.isFinite(minRaw) ? minRaw : null;
    const max = Number.isFinite(maxRaw) ? maxRaw : null;
    const sort = ['new', 'price-asc', 'price-desc'].includes(opts.sort) ? opts.sort : 'new';
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const pageSize = Math.min(60, Math.max(1, parseInt(opts.pageSize, 10) || 24));
    const verifiedOnly = opts.verifiedOnly !== false; // default: gate to verified sellers

    // Resolve the set of verified sellers up-front so the gating is part of the
    // query (not a post-pagination filter).
    let verifiedEmails = null;
    if (verifiedOnly) {
      verifiedEmails = new Set(await listVerifiedSellerEmails());
    }

    const matches = (l) => {
      if (l.status !== 'active') return false;
      if (verifiedEmails && !verifiedEmails.has(l.sellerEmail)) return false;
      if (cat && cat !== 'all' && l.cat !== cat) return false;
      if (min != null && !(l.price >= min)) return false;
      if (max != null && !(l.price <= max)) return false;
      if (q) {
        const hay = `${l.title || ''} ${l.desc || ''} ${l.sellerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    const sorter = (a, b) => {
      if (sort === 'price-asc') return (a.price || 0) - (b.price || 0);
      if (sort === 'price-desc') return (b.price || 0) - (a.price || 0);
      return new Date(b.createdAt) - new Date(a.createdAt);
    };

    if (memory) {
      const all = [...memory.listings.values()].filter(matches).sort(sorter);
      const total = all.length;
      return { items: all.slice((page - 1) * pageSize, page * pageSize), total, page, pages: Math.max(1, Math.ceil(total / pageSize)), pageSize };
    }

    const filter = { status: 'active' };
    if (verifiedEmails) filter.sellerEmail = { $in: [...verifiedEmails] };
    if (cat && cat !== 'all') filter.cat = cat;
    if (min != null || max != null) {
      filter.price = {};
      if (min != null) filter.price.$gte = min;
      if (max != null) filter.price.$lte = max;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { desc: rx }, { sellerName: rx }];
    }
    const sortSpec = sort === 'price-asc' ? { price: 1 } : sort === 'price-desc' ? { price: -1 } : { createdAt: -1 };
    const total = await listingsCol.countDocuments(filter);
    const items = await listingsCol.find(filter).sort(sortSpec).skip((page - 1) * pageSize).limit(pageSize).toArray();
    return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), pageSize };
  }

  async function listSellerListings(sellerEmail) {
    const filter = { sellerEmail, status: { $ne: 'removed' } };
    if (memory) {
      return [...memory.listings.values()]
        .filter(l => l.sellerEmail === sellerEmail && l.status !== 'removed')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return listingsCol.find(filter).sort({ createdAt: -1 }).limit(200).toArray();
  }

  async function getSellerProfile(email) {
    if (memory) return memory.sellerProfiles.get(email) || null;
    return sellerProfilesCol.findOne({ _id: email });
  }

  async function saveSellerProfile(profile) {
    profile.updatedAt = new Date();
    if (memory) {
      memory.sellerProfiles.set(profile._id, profile);
      return;
    }
    await sellerProfilesCol.replaceOne({ _id: profile._id }, profile, { upsert: true });
  }

  async function listSellerProfiles() {
    if (memory) return [...memory.sellerProfiles.values()];
    return sellerProfilesCol.find({}).limit(500).toArray();
  }

  /* Every verified seller email — unbounded, used to build the search
   * allowlist. Capping this at 500 silently dropped listings from verified
   * sellers #501+ from marketplace search. */
  async function listVerifiedSellerEmails() {
    if (memory) {
      return [...memory.sellerProfiles.values()].filter(p => p?.verified).map(p => p._id);
    }
    const docs = await sellerProfilesCol.find({ verified: true }, { projection: { _id: 1 } }).toArray();
    return docs.map(d => d._id);
  }

  async function ensureSellerProfile(email, name) {
    let profile = await getSellerProfile(email);
    if (!profile) {
      profile = defaultSellerProfile(email, name);
      await saveSellerProfile(profile);
    }
    return profile;
  }

  async function listWithdrawals(sellerEmail) {
    if (memory) {
      return [...memory.withdrawals.values()]
        .filter(w => w.sellerEmail === sellerEmail)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return withdrawalsCol.find({ sellerEmail }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  async function saveWithdrawal(doc) {
    if (memory) {
      memory.withdrawals.set(doc._id, doc);
      return;
    }
    await withdrawalsCol.insertOne(doc);
  }

  /**
   * Atomically debit a seller's available balance for a withdrawal. Returns
   * { profile } on success, { insufficient: true, balance } when underfunded.
   * The conditional update guarantees concurrent withdrawals / payouts can
   * never overdraw the account.
   */
  async function debitSellerBalance(email, amount, ledgerEntry) {
    const amt = round2(amount);
    if (!Number.isFinite(amt) || amt <= 0) return { invalid: true };
    if (memory) {
      const profile = await getSellerProfile(email);
      if (!profile) return { notFound: true };
      const bal = round2(profile.balance || 0);
      if (amt > bal) return { insufficient: true, balance: bal };
      profile.balance = round2(bal - amt);
      profile.ledger = profile.ledger || [];
      profile.ledger.unshift(ledgerEntry);
      profile.ledger = profile.ledger.slice(0, 200);
      await saveSellerProfile(profile);
      return { profile };
    }
    const res = await sellerProfilesCol.findOneAndUpdate(
      { _id: email, balance: { $gte: amt } },
      {
        $inc: { balance: -amt },
        $push: { ledger: { $each: [ledgerEntry], $position: 0, $slice: 200 } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) {
      const cur = await getSellerProfile(email);
      if (!cur) return { notFound: true };
      return { insufficient: true, balance: round2(cur.balance || 0) };
    }
    return { profile: doc };
  }

  /**
   * Credit a seller's balance (e.g. withdrawal rejected). Atomic $inc.
   */
  async function creditSellerBalance(email, amount, ledgerEntry) {
    const amt = round2(amount);
    if (!Number.isFinite(amt) || amt <= 0) return { invalid: true };
    if (memory) {
      const profile = await getSellerProfile(email);
      if (!profile) return { notFound: true };
      profile.balance = round2((profile.balance || 0) + amt);
      profile.ledger = profile.ledger || [];
      profile.ledger.unshift(ledgerEntry);
      profile.ledger = profile.ledger.slice(0, 200);
      await saveSellerProfile(profile);
      return { profile };
    }
    const res = await sellerProfilesCol.findOneAndUpdate(
      { _id: email },
      {
        $inc: { balance: amt },
        $push: { ledger: { $each: [ledgerEntry], $position: 0, $slice: 200 } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    return doc ? { profile: doc } : { notFound: true };
  }

  async function getEscrow(dealId) {
    if (!dealId) return null;
    if (memory) return memory.escrows.get(dealId) || null;
    return escrowsCol.findOne({ _id: dealId });
  }

  async function saveEscrow(rec) {
    if (memory) {
      memory.escrows.set(rec._id, rec);
      return;
    }
    await escrowsCol.replaceOne({ _id: rec._id }, rec, { upsert: true });
  }

  /**
   * Record a server-side escrow hold for a deal. Idempotent on dealId, so
   * webhook retries / duplicate client calls never double-count. The recorded
   * amount + seller become the source of truth for the later payout.
   */
  async function holdEscrow({ dealId, buyerEmail, sellerEmail, amount, method, title }) {
    if (!dealId || !sellerEmail) return { escrow: null, duplicate: false };

    if (memory) {
      return withLock('hold:' + dealId, async () => {
        const existing = await getEscrow(dealId);
        if (existing) return { escrow: existing, duplicate: true };
        const rec = {
          _id: dealId,
          buyerEmail: buyerEmail || null,
          sellerEmail,
          amount: round2(amount),
          method: method || null,
          title: title || '',
          status: 'held',
          createdAt: new Date(),
        };
        await saveEscrow(rec);
        const profile = await ensureSellerProfile(sellerEmail);
        profile.escrowHolds = profile.escrowHolds || [];
        if (!profile.escrowHolds.includes(dealId)) {
          profile.escrowHolds.push(dealId);
          profile.pendingEscrow = round2((profile.pendingEscrow || 0) + rec.amount);
          await saveSellerProfile(profile);
        }
        return { escrow: rec, duplicate: false };
      });
    }

    // Mongo: the escrow _id is the idempotency key — insert once. A concurrent
    // first-time hold hits the duplicate key error and becomes a no-op.
    const existing = await getEscrow(dealId);
    if (existing) return { escrow: existing, duplicate: true };

    const rec = {
      _id: dealId,
      buyerEmail: buyerEmail || null,
      sellerEmail,
      amount: round2(amount),
      method: method || null,
      title: title || '',
      status: 'held',
      createdAt: new Date(),
    };
    try {
      await escrowsCol.insertOne(rec);
    } catch (err) {
      if (err && err.code === 11000) return { escrow: await getEscrow(dealId), duplicate: true };
      throw err;
    }

    // Track the hold on the seller profile exactly once (addToSet is the
    // idempotency guard; only bump pendingEscrow when it actually added).
    await ensureSellerProfile(sellerEmail);
    const tracked = await sellerProfilesCol.findOneAndUpdate(
      { _id: sellerEmail, escrowHolds: { $ne: dealId } },
      {
        $inc: { pendingEscrow: rec.amount },
        $addToSet: { escrowHolds: dealId },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
    void tracked; // pendingEscrow bumps only when this call added the hold
    return { escrow: rec, duplicate: false };
  }

  /**
   * Release a held escrow to the seller. The gross amount and seller are taken
   * from the recorded escrow — never from the request — and the buyer that
   * opened the escrow must be the one confirming delivery.
   *
   * The escrow is flipped to 'released' with a single conditional update first,
   * so a concurrent release (double-click, retry, webhook) loses the race and
   * can't pay out twice. The balance credit is an atomic $inc, not read-modify-write.
   */
  async function creditSellerPayout({ dealId, buyerEmail }) {
    const escrow = await getEscrow(dealId);
    if (!escrow) return { notFound: true };
    if (buyerEmail && escrow.buyerEmail && escrow.buyerEmail !== buyerEmail) {
      return { forbidden: true };
    }

    const sellerEmail = escrow.sellerEmail;
    const grossAmount = escrow.amount;
    const fees = calcDealFees(grossAmount);
    const fee = fees.platformFee;
    const net = fees.sellerNet;
    const ledgerEntry = {
      type: 'payout',
      amt: net,
      fee,
      gross: grossAmount,
      lbl: `Payout · ${dealId} · ${escrow.title || 'Sale'}`,
      dealId,
      t: 'just now',
      at: new Date(),
    };

    if (memory) {
      return withLock('payout:' + dealId, async () => {
        // Only a payable escrow may release. 'refunded' is terminal too — a
        // refunded deal that still paid the seller would be a double spend.
        if (!['held', 'delivered', 'dispute'].includes(escrow.status)) return { duplicate: true };
        // Claim the release before the profile credit below. Both run inside the
        // per-deal lock so a concurrent release/refund can't interleave.
        escrow.status = 'released';
        escrow.releasedAt = new Date();
        const profile = await ensureSellerProfile(sellerEmail);
        profile.balance = round2((profile.balance || 0) + net);
        profile.totalEarnings = round2((profile.totalEarnings || 0) + net);
        profile.pendingEscrow = Math.max(0, round2((profile.pendingEscrow || 0) - grossAmount));
        profile.deals = (profile.deals || 0) + 1;
        profile.ledger = profile.ledger || [];
        profile.ledger.unshift(ledgerEntry);
        profile.ledger = profile.ledger.slice(0, 200);
        await saveSellerProfile(profile);
        await saveEscrow(escrow);
        return { profile, net, fee };
      });
    }

    // Mongo: claim the release atomically. Only one caller transitions out of
    // a payable state; 'refunded' is terminal exactly like 'released', or an
    // already-refunded deal could pay the seller too (double spend).
    await ensureSellerProfile(sellerEmail);
    const claim = await escrowsCol.updateOne(
      { _id: dealId, status: { $in: ['held', 'delivered', 'dispute'] } },
      { $set: { status: 'released', releasedAt: new Date() } }
    );
    if (claim.matchedCount === 0 || claim.modifiedCount === 0) {
      return { duplicate: true };
    }
    await sellerProfilesCol.updateOne(
      { _id: sellerEmail },
      {
        $inc: {
          balance: net,
          totalEarnings: net,
          pendingEscrow: -grossAmount,
          deals: 1,
        },
        $push: { ledger: { $each: [ledgerEntry], $position: 0, $slice: 200 } },
        $set: { updatedAt: new Date() },
      }
    );
    // Remove the released hold from the durable tracker list.
    await sellerProfilesCol.updateOne(
      { _id: sellerEmail },
      { $pull: { escrowHolds: dealId } }
    );
    // Clamp pendingEscrow so it never drifts negative.
    await sellerProfilesCol.updateOne(
      { _id: sellerEmail, pendingEscrow: { $lt: 0 } },
      { $set: { pendingEscrow: 0 } }
    );
    const profile = await getSellerProfile(sellerEmail);
    return { profile, net, fee };
  }

  /* ---------- #4/#6 escrow delivery & dispute state machine ----------
   * Statuses: held → delivered → released (buyer confirm) | refunded (arbiter)
   *                  held → dispute → released | refunded (arbiter decision)
   * All transitions are guarded so they can only fire from a valid prior state
   * and by the right party. Money only ever moves on release/refund.
   */

  async function _setEscrowState(dealId, fromStates, patch) {
    if (memory) {
      const e = memory.escrows.get(dealId);
      if (!e) return { notFound: true };
      if (!fromStates.includes(e.status)) return { badState: true, status: e.status };
      Object.assign(e, patch);
      memory.escrows.set(dealId, e);
      return { escrow: e };
    }
    const res = await escrowsCol.findOneAndUpdate(
      { _id: dealId, status: { $in: fromStates } },
      { $set: patch },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) {
      const cur = await getEscrow(dealId);
      if (!cur) return { notFound: true };
      return { badState: true, status: cur.status };
    }
    return { escrow: doc };
  }

  /** Seller marks the goods delivered (attaches proof for the record). */
  async function markDelivered({ dealId, sellerEmail, proof }) {
    const escrow = await getEscrow(dealId);
    if (!escrow) return { notFound: true };
    if (escrow.sellerEmail !== sellerEmail) return { forbidden: true };
    return _setEscrowState(dealId, ['held'], {
      status: 'delivered',
      deliveredAt: new Date(),
      deliveryProof: String(proof || '').slice(0, 2000),
    });
  }

  /** Buyer opens a dispute (reason required). Freezes the escrow for the arbiter. */
  async function openDispute({ dealId, buyerEmail, reason }) {
    const escrow = await getEscrow(dealId);
    if (!escrow) return { notFound: true };
    if (buyerEmail && escrow.buyerEmail && escrow.buyerEmail !== buyerEmail) return { forbidden: true };
    return _setEscrowState(dealId, ['held', 'delivered'], {
      status: 'dispute',
      disputedAt: new Date(),
      disputeReason: String(reason || '').slice(0, 1000),
    });
  }

  /**
   * Arbiter resolves a dispute (or refunds an un-delivered order).
   * resolution: 'release' (pay seller) | 'refund' (return to buyer).
   *
   * Refund routing depends on how the deal was funded. A wallet-backed escrow
   * is refunded straight back into the buyer's internal wallet (the funds were
   * actually moved there). A crypto-backed escrow must NOT credit the internal
   * wallet: the real money sits at the payment provider, so minting internal
   * balance would create an unbacked platform liability the buyer could then
   * withdraw. For crypto we only unwind the escrow and flag the record for an
   * out-of-band provider refund, which an operator processes off-platform.
   */
  async function resolveEscrow({ dealId, resolution, walletStore, paymentStore, stockStore }) {
    if (memory) return withLock('resolve:' + dealId, () => _resolveEscrow({ dealId, resolution, walletStore, paymentStore, stockStore }));
    return _resolveEscrow({ dealId, resolution, walletStore, paymentStore, stockStore });
  }

  async function _resolveEscrow({ dealId, resolution, walletStore, paymentStore, stockStore }) {
    const escrow = await getEscrow(dealId);
    if (!escrow) return { notFound: true };
    if (!['dispute', 'held', 'delivered'].includes(escrow.status)) {
      return { badState: true, status: escrow.status };
    }
    if (resolution === 'release') {
      // Reuse the atomic payout path (handles duplicate protection + fees).
      return { released: true, payout: await creditSellerPayout({ dealId, buyerEmail: null }) };
    }
    if (resolution === 'refund') {
      const claim = await _setEscrowState(dealId, ['dispute', 'held', 'delivered'], {
        status: 'refunded',
        refundedAt: new Date(),
      });
      if (claim.notFound) return { notFound: true };
      if (claim.badState) return { duplicate: true };

      // Decide whether this escrow was genuinely wallet-funded. Trust the
      // verified payment record when present; fall back to the escrow method
      // (escrows opened before a payment record existed are wallet-only here).
      let payment = null;
      if (paymentStore && typeof paymentStore.getByOrderId === 'function') {
        try { payment = await paymentStore.getByOrderId(dealId); } catch (_) { payment = null; }
      }
      const isWalletBacked = payment ? (payment.method === 'wallet' || payment.provider === 'wallet') : escrow.method === 'wallet';

      if (isWalletBacked && walletStore && escrow.buyerEmail) {
        // Return internal funds to the buyer wallet and release the hold so the
        // buyer isn't left with a stuck hold blocking a re-payment.
        await walletStore.deposit(escrow.buyerEmail, escrow.amount, `Refund · ${dealId}`);
        await walletStore.releaseHold(escrow.buyerEmail, dealId);
        if (payment) {
          payment.refundStatus = 'wallet_credited';
          payment.refundedAt = new Date();
          try { await paymentStore.save(payment); } catch (_) {}
        }
      } else {
        // Crypto-backed: do NOT mint internal wallet balance. Mark the payment
        // record so an operator issues the refund at the provider off-platform.
        claim.escrow.refundMethod = 'crypto_external';
        await saveEscrow(claim.escrow);
        if (payment) {
          payment.refundStatus = 'requires_provider_refund';
          payment.refundedAt = new Date();
          try { await paymentStore.save(payment); } catch (_) {}
        }
      }
      if (memory) {
        const profile = await getSellerProfile(escrow.sellerEmail);
        if (profile) {
          profile.pendingEscrow = Math.max(0, round2((profile.pendingEscrow || 0) - escrow.amount));
          await saveSellerProfile(profile);
        }
      } else {
        await sellerProfilesCol.updateOne(
          { _id: escrow.sellerEmail },
          { $inc: { pendingEscrow: -escrow.amount }, $set: { updatedAt: new Date() } }
        );
        await sellerProfilesCol.updateOne(
          { _id: escrow.sellerEmail, pendingEscrow: { $lt: 0 } },
          { $set: { pendingEscrow: 0 } }
        );
      }
      // A refunded credential was already delivered to the buyer (decrypted,
      // emailed, revealable) — it must never return to the sellable pool, or
      // the next buyer pays for a secret the refunded buyer still has. Retire
      // the unit as compromised; the seller must rotate the credential and
      // restock manually. No-op for manual-delivery orders. Idempotent.
      if (stockStore && typeof stockStore.retireForOrder === 'function') {
        try { await stockStore.retireForOrder(dealId); } catch (_) {}
      }
      return { refunded: true, escrow: claim.escrow };
    }
    return { badResolution: true };
  }

  async function listDisputedEscrows(limit = 100) {
    if (memory) {
      return [...memory.escrows.values()]
        .filter(e => e.status === 'dispute')
        .sort((a, b) => new Date(b.disputedAt || 0) - new Date(a.disputedAt || 0))
        .slice(0, limit);
    }
    return escrowsCol.find({ status: 'dispute' }).sort({ disputedAt: -1 }).limit(limit).toArray();
  }

  /* Escrows belonging to a seller (newest first) — drives the seller delivery UI. */
  async function listSellerEscrows(sellerEmail, limit = 100) {
    if (memory) {
      return [...memory.escrows.values()]
        .filter(e => e.sellerEmail === sellerEmail)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, limit);
    }
    return escrowsCol.find({ sellerEmail }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  /* Every escrow (newest first) — powers the admin all-orders view. */
  async function listAllEscrows(limit = 200) {
    if (memory) {
      return [...memory.escrows.values()]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, limit);
    }
    return escrowsCol.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  function maskBuyerName(email, name) {
    const n = String(name || email?.split('@')[0] || 'Buyer').trim();
    if (n.length <= 2) return n[0] + '***';
    return n.slice(0, 1) + '***' + n.slice(-1);
  }

  function recalculateRate(reviews) {
    if (!reviews.length) return 5;
    const sum = reviews.reduce((a, r) => a + (r.rating || 5), 0);
    return Math.round((sum / reviews.length) * 10) / 10;
  }

  async function getReview(dealId) {
    if (!dealId) return null;
    if (memory) return memory.reviews.get(dealId) || null;
    return reviewsCol.findOne({ _id: dealId });
  }

  async function listReviewsForSeller(sellerEmail) {
    const filter = { sellerEmail };
    if (memory) {
      return [...memory.reviews.values()]
        .filter(r => r.sellerEmail === sellerEmail)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return reviewsCol.find(filter).sort({ createdAt: -1 }).limit(100).toArray();
  }

  /**
   * One review per completed deal. Buyer must be the escrow buyer and escrow
   * must already be released.
   */
  async function addReview({ dealId, buyerEmail, buyerName, rating, text }) {
    const escrow = await getEscrow(dealId);
    // Only a completed, delivered-then-released purchase is reviewable.
    if (!escrow || escrow.status !== 'released' || !escrow.deliveredAt) return { notEligible: true };
    if (buyerEmail && escrow.buyerEmail && escrow.buyerEmail !== buyerEmail) return { forbidden: true };
    if (await getReview(dealId)) return { duplicate: true };

    const stars = Math.min(5, Math.max(1, Math.round(Number(rating) || 5)));
    const review = {
      _id: dealId,
      dealId,
      sellerEmail: escrow.sellerEmail,
      buyerEmail: buyerEmail || escrow.buyerEmail,
      buyerName: buyerName || maskBuyerName(buyerEmail),
      dealTitle: escrow.title || '',
      rating: stars,
      text: String(text || '').trim().slice(0, 500),
      createdAt: new Date(),
    };
    if (memory) {
      memory.reviews.set(review._id, review);
    } else {
      await reviewsCol.insertOne(review);
    }

    const profile = await ensureSellerProfile(escrow.sellerEmail);
    const all = await listReviewsForSeller(escrow.sellerEmail);
    profile.rate = recalculateRate(all);
    await saveSellerProfile(profile);

    return { review, profile };
  }

  async function getPublicSellerProfile(email) {
    const id = String(email || '').trim().toLowerCase();
    if (!id) return null;
    const profile = await getSellerProfile(id);
    if (!profile?.verified) return null;
    return buildPublicProfile(profile);
  }

  function sellerSlug(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async function getPublicSellerProfileBySlug(slug) {
    const id = String(slug || '').trim().toLowerCase();
    if (!id) return null;
    // Direct email match first (backwards compatibility with old #seller/email links).
    const direct = await getSellerProfile(id);
    if (direct?.verified) return buildPublicProfile(direct);
    // Otherwise resolve by name slug across verified profiles.
    const profiles = await listSellerProfiles();
    const match = profiles.find(p => p?.verified && sellerSlug(p.name || p._id.split('@')[0]) === id);
    if (!match) return null;
    return buildPublicProfile(match);
  }

  async function buildPublicProfile(profile) {
    const id = profile._id;
    const listingDocs = await listSellerListings(id);
    const activeListings = listingDocs.filter(l => l.status === 'active');
    const reviews = await listReviewsForSeller(id);
    const registeredAt = profile.verifiedAt || profile.createdAt || null;
    const name = profile.name || profile._id.split('@')[0];

    return {
      email: profile._id,
      slug: sellerSlug(name),
      name,
      verified: true,
      registeredAt,
      since: profile.since || '',
      rate: profile.rate ?? recalculateRate(reviews),
      reviewCount: reviews.length,
      // Sales = paid orders (durable counter), not completed payouts — a seller
      // holding delivered orders awaiting confirmation has genuinely sold them.
      soldCount: profile.sales ?? profile.deals ?? 0,
      listingsCount: activeListings.length,
      listings: activeListings.map(doc => serializeListing(doc, profile)),
      reviews: reviews.map(r => ({
        dealId: r.dealId,
        rating: r.rating,
        text: r.text || '',
        buyerName: maskBuyerName(r.buyerEmail, r.buyerName),
        dealTitle: r.dealTitle || '',
        at: r.createdAt,
      })),
    };
  }

  function serializeSellerProfile(p) {
    if (!p) return null;
    return {
      email: p._id,
      name: p.name,
      verified: !!p.verified,
      balance: p.balance || 0,
      pendingEscrow: p.pendingEscrow || 0,
      totalEarnings: p.totalEarnings || 0,
      deals: p.deals || 0,
      sales: p.sales ?? p.deals ?? 0,
      rate: p.rate ?? 5,
      since: p.since || '',
      withdrawAddress: p.withdrawAddress || '',
      ledger: (p.ledger || []).slice(0, 50),
    };
  }

  /* Record a paid sale on the seller profile. Drives the public "sold" count
   * so it reflects actual paid orders, not only completed payouts. */
  async function recordSale(sellerEmail) {
    if (!sellerEmail) return;
    if (memory) {
      const profile = await ensureSellerProfile(sellerEmail);
      profile.sales = (profile.sales || 0) + 1;
      await saveSellerProfile(profile);
      return;
    }
    await ensureSellerProfile(sellerEmail);
    await sellerProfilesCol.updateOne(
      { _id: sellerEmail },
      { $inc: { sales: 1 }, $set: { updatedAt: new Date() } }
    );
  }

  return {
    calcDealFees,
    feeConfig,
    defaultSellerProfile,
    serializeListing,
    serializeSellerProfile,
    getListing,
    saveListing,
    deleteListing,
    listPublicListings,
    searchListings,
    listSellerListings,
    getSellerProfile,
    saveSellerProfile,
    ensureSellerProfile,
    listSellerProfiles,
    listVerifiedSellerEmails,
    listWithdrawals,
    saveWithdrawal,
    debitSellerBalance,
    creditSellerBalance,
    creditSellerPayout,
    getEscrow,
    holdEscrow,
    markDelivered,
    openDispute,
    resolveEscrow,
    listDisputedEscrows,
    listSellerEscrows,
    listAllEscrows,
    getReview,
    listReviewsForSeller,
    addReview,
    getPublicSellerProfile,
    getPublicSellerProfileBySlug,
    sellerSlug,
    recordSale,
  };
}

module.exports = { createSellerStore, defaultSellerProfile, sanitizeVariants, MAX_VARIANTS, MAX_VARIANT_LABEL_LEN };
