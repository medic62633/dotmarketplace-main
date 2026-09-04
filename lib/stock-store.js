/* Server-authoritative credential stock for automated delivery.
 *
 * Sellers pre-stock account/subscription credentials on a listing. Each secret
 * is encrypted at rest with AES-256-GCM (per-record random IV) and is NEVER
 * returned to any client until a buyer's payment for that listing is confirmed.
 * When a payment confirms, exactly one available unit is atomically claimed for
 * that order (single-winner, so two buyers can never receive the same unit) and
 * only the recorded buyer — re-authorized on every request — can decrypt+read it.
 *
 * Trust root: STOCK_SECRET. Losing it makes all stored credentials
 * unrecoverable. Rotation would require re-encrypting every record (out of scope).
 */
const crypto = require('crypto');

const MAX_STOCK_PER_LISTING = 500;
const MAX_SECRET_LEN = 2000;

/* Derive a stable 32-byte key. A 64-char hex secret is used raw; any other
 * non-empty string is scrypt-stretched to 32 bytes. */
function deriveKeyFrom(raw) {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.scryptSync(raw, 'dotmarket-stock', 32);
}

function deriveKey() {
  const raw = process.env.STOCK_SECRET || '';
  if (!raw) {
    // Dev/in-memory convenience only. Production boot is blocked by validateEnv.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('STOCK_SECRET is required in production to encrypt credential stock.');
    }
    return crypto.scryptSync('dot-marketplace-insecure-dev-stock-secret', 'dotmarket-stock', 32);
  }
  return deriveKeyFrom(raw);
}

function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') };
}

function decryptSecret(rec, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(rec.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(rec.ct, 'hex')), decipher.final()]).toString('utf8');
}

function createStockStore({ memory, stockCol }) {
  const key = deriveKey();
  /* Rotation fallback: after STOCK_SECRET is rotated, credentials written with
   * the previous secret still decrypt via STOCK_SECRET_OLD until they're all
   * sold/retired. New stock always encrypts with the current key. */
  const oldKey = process.env.STOCK_SECRET_OLD ? deriveKeyFrom(process.env.STOCK_SECRET_OLD) : null;

  /* Per-listing promise chains serialize the scan-and-claim in the memory store
   * (mirrors the wallet-store withLock pattern). Mongo uses a single conditional
   * findOneAndUpdate and needs no lock. */
  const _locks = new Map();
  function withLock(key, fn) {
    const prev = _locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    _locks.set(key, next.catch(() => {}));
    return next;
  }

  /* All mutations tied to one order must share a lock chain — keying only by
   * listingId would let an order-level op (retire/release) race a claim-level
   * op on the same unit. */
  function listingLockKey(listingId, orderId) {
    return orderId ? 'order:' + orderId : 'listing:' + listingId;
  }

  /* variantId is null for a classic single-price listing, or the id of one of
   * the listing's price options (e.g. a $10/$50/$100 gift-card denomination)
   * — each variant keeps its own separate stock pool. Normalized to null so
   * an omitted/undefined caller argument and a legacy stock doc with no
   * variantId field at all (Mongo matches null against a missing field too)
   * are treated the same. */
  async function countAvailable(listingId, variantId) {
    const vid = variantId || null;
    if (memory) {
      let n = 0;
      for (const s of memory.stock.values()) {
        if (s.listingId === listingId && s.status === 'available' && (s.variantId || null) === vid) n++;
      }
      return n;
    }
    return stockCol.countDocuments({ listingId, variantId: vid, status: 'available' });
  }

  /* Every unit ever stocked for this listing/variant regardless of status —
   * the figure MAX_STOCK_PER_LISTING is a cap on. Sold and compromised units
   * still occupy the listing's allowance; they are history that was really
   * stored, not free space. */
  async function countStored(listingId, variantId) {
    const vid = variantId || null;
    if (memory) {
      let n = 0;
      for (const s of memory.stock.values()) {
        if (s.listingId === listingId && (s.variantId || null) === vid) n++;
      }
      return n;
    }
    return stockCol.countDocuments({ listingId, variantId: vid });
  }

  async function addStock(listingId, sellerEmail, secrets, variantId) {
    const vid = variantId || null;
    // MAX_STOCK_PER_LISTING is a cap on the LISTING, not on one request. It
    // used to slice each call's list and nothing more, so repeating the call
    // grew a listing's stock without limit — the constant asserted an
    // invariant the code never enforced. Count what is already there and only
    // accept up to the remaining room.
    const alreadyHeld = await countStored(listingId, vid);
    const room = Math.max(0, MAX_STOCK_PER_LISTING - alreadyHeld);
    const cleaned = (Array.isArray(secrets) ? secrets : [])
      .map(s => String(s || '').trim())
      .filter(s => s.length > 0);
    const list = cleaned.slice(0, room);
    if (!list.length) {
      return {
        added: 0,
        available: await countAvailable(listingId, vid),
        rejected: cleaned.length,
        full: cleaned.length > 0 && room === 0,
        limit: MAX_STOCK_PER_LISTING,
      };
    }

    const now = new Date();
    const docs = list.map(s => ({
      _id: crypto.randomBytes(12).toString('hex'),
      listingId,
      variantId: vid,
      sellerEmail,
      status: 'available',
      orderId: null,
      buyerEmail: null,
      ...encryptSecret(s.slice(0, MAX_SECRET_LEN), key),
      createdAt: now,
    }));

    if (memory) {
      for (const d of docs) memory.stock.set(d._id, d);
    } else {
      await stockCol.insertMany(docs);
    }
    return {
      added: docs.length,
      available: await countAvailable(listingId, vid),
      rejected: cleaned.length - list.length,
      full: cleaned.length > list.length,
      limit: MAX_STOCK_PER_LISTING,
    };
  }

  /* Atomically claim one unit for an order. If the order already reserved a
   * unit (at invoice-creation time) it is finalized to sold; otherwise an
   * available unit is claimed directly (legacy/late-claim path). Single-winner
   * and idempotent per order. Returns the claimed doc, or { empty: true }. */
  async function claimOne(listingId, orderId, buyerEmail, variantId) {
    const finalized = await finalizeClaim(orderId);
    if (finalized.doc) return finalized;
    const reserved = await reserveOne(listingId, orderId, buyerEmail, variantId);
    if (reserved.doc) return finalizeClaim(orderId);
    return reserved; // { empty: true }
  }

  async function getForOrder(orderId) {
    if (memory) {
      for (const s of memory.stock.values()) if (s.orderId === orderId) return s;
      return null;
    }
    return stockCol.findOne({ orderId });
  }

  /* Whether the listing (or one specific variant of it) has any stock record
   * at all (available or sold) — distinguishes an auto-delivery listing/
   * variant from a manual-delivery one. */
  async function hasAny(listingId, variantId) {
    const vid = variantId || null;
    if (memory) {
      for (const s of memory.stock.values()) {
        if (s.listingId === listingId && (s.variantId || null) === vid) return true;
      }
      return false;
    }
    const doc = await stockCol.findOne({ listingId, variantId: vid }, { projection: { _id: 1 } });
    return !!doc;
  }

  /* Retire a unit after a refund. The credential was already delivered to the
   * refunded buyer (decrypted + emailed), so it must NEVER return to the
   * sellable pool — the next buyer would pay for a secret the refunded buyer
   * still has. The unit is flagged 'compromised' so the seller sees it needs a
   * credential rotation + manual restock. Idempotent; also covers any
   * still-reserved unit for the order. */
  async function retireForOrder(orderId, { session } = {}) {
    const patch = {
      status: 'compromised',
      compromisedAt: new Date(),
      compromisedReason: 'refunded_after_delivery',
    };
    if (memory) {
      return withLock(listingLockKey(null, orderId), async () => {
        const s = await getForOrder(orderId);
        if (!s || !['sold', 'reserved'].includes(s.status)) return { retired: false };
        Object.assign(s, patch);
        memory.stock.set(s._id, s);
        return { retired: true };
      });
    }
    const res = await stockCol.findOneAndUpdate(
      { orderId, status: { $in: ['sold', 'reserved'] } },
      { $set: patch },
      { returnDocument: 'after', session }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    return { retired: !!doc };
  }

  /* Reserve one available unit for an order BEFORE money moves (invoice
   * creation / wallet pay). This makes the out-of-stock check and the claim
   * atomic across concurrent buyers: two simultaneous purchases of a 1-unit
   * listing can no longer both confirm payment and race for the unit.
   * Idempotent per order. */
  async function reserveOne(listingId, orderId, buyerEmail, variantId) {
    const vid = variantId || null;
    if (memory) {
      return withLock(listingLockKey(listingId, orderId), async () => {
        for (const s of memory.stock.values()) {
          if (s.orderId === orderId && ['reserved', 'sold'].includes(s.status)) return { doc: s };
        }
        let unit = null;
        for (const s of memory.stock.values()) {
          if (s.listingId === listingId && s.status === 'available' && (s.variantId || null) === vid) { unit = s; break; }
        }
        if (!unit) return { empty: true };
        unit.status = 'reserved';
        unit.orderId = orderId;
        unit.buyerEmail = buyerEmail;
        unit.reservedAt = new Date();
        memory.stock.set(unit._id, unit);
        return { doc: unit };
      });
    }
    const existing = await stockCol.findOne({ orderId, status: { $in: ['reserved', 'sold'] } });
    if (existing) return { doc: existing };
    const res = await stockCol.findOneAndUpdate(
      { listingId, variantId: vid, status: 'available' },
      { $set: { status: 'reserved', orderId, buyerEmail, reservedAt: new Date() } },
      { returnDocument: 'after', sort: { createdAt: 1 } }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) return { empty: true };
    return { doc };
  }

  /* Flip an order's reserved unit to sold once payment confirms. If no
   * reservation exists (legacy order paid before reservations), fall back to a
   * direct claim so delivery still works. */
  async function finalizeClaim(orderId) {
    if (memory) {
      const s = await getForOrder(orderId);
      if (!s) return { empty: true };
      if (s.status === 'sold') return { doc: s };
      if (s.status !== 'reserved') return { empty: true };
      return withLock(listingLockKey(s.listingId, orderId), async () => {
        if (s.status === 'sold') return { doc: s };
        if (s.status !== 'reserved') return { empty: true };
        s.status = 'sold';
        s.soldAt = new Date();
        memory.stock.set(s._id, s);
        return { doc: s };
      });
    }
    const sold = await stockCol.findOne({ orderId, status: 'sold' });
    if (sold) return { doc: sold };
    const res = await stockCol.findOneAndUpdate(
      { orderId, status: 'reserved' },
      { $set: { status: 'sold', soldAt: new Date() } },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) return { empty: true };
    return { doc };
  }

  /* Release a reservation back to the pool — checkout cancelled or the invoice
   * expired unpaid. Only touches still-reserved units; a sold unit is never
   * restocked here (refunds retire instead). Idempotent. */
  async function releaseReservation(orderId) {
    if (memory) {
      return withLock(listingLockKey(null, orderId), async () => {
        const s = await getForOrder(orderId);
        if (!s || s.status !== 'reserved') return { released: false };
        s.status = 'available';
        s.orderId = null;
        s.buyerEmail = null;
        s.reservedAt = null;
        memory.stock.set(s._id, s);
        return { released: true };
      });
    }
    const res = await stockCol.findOneAndUpdate(
      { orderId, status: 'reserved' },
      { $set: { status: 'available', orderId: null, buyerEmail: null, reservedAt: null } },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    return { released: !!doc };
  }

  /* Decrypt a claimed record. Caller is responsible for authorization. Falls
   * back to the pre-rotation key for credentials written before a secret
   * rotation. */
  function reveal(rec) {
    if (!rec || !rec.iv || !rec.ct || !rec.tag) return null;
    try {
      return decryptSecret(rec, key);
    } catch (err) {
      if (!oldKey) throw err;
      return decryptSecret(rec, oldKey);
    }
  }

  return { addStock, countAvailable, countStored, claimOne, getForOrder, hasAny, retireForOrder, reserveOne, finalizeClaim, releaseReservation, reveal, MAX_STOCK_PER_LISTING };
}

module.exports = { createStockStore };
