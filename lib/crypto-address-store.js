/* Pool of platform-owned crypto deposit addresses for accepting payments
 * directly on-chain, no payment processor in the loop.
 *
 * Mirrors lib/stock-store.js's pool/claim pattern deliberately: an operator
 * (admin) pre-generates addresses in their own wallet software (this app
 * never generates or holds a private key), pastes the public addresses in,
 * and one is atomically claimed per order — exactly like a stocked
 * credential is claimed per order. That reuse is intentional: it's an
 * already-audited concurrency pattern, not a new one to get subtly wrong for
 * something this high-stakes.
 *
 * Claiming an address here does NOT mean payment was received — it only
 * reserves which address a specific order should watch/pay into. Detecting
 * the actual on-chain payment is the payment provider module's job (e.g.
 * lib/payments/native-tron.js), which polls the chain for that address.
 */
const crypto = require('crypto');

function createCryptoAddressStore({ memory, cryptoAddressesCol }) {
  /* Per-network promise chains serialize the claim's scan-then-write in the
   * memory store, same as stock-store.js's withLock — Mongo needs no lock,
   * a single conditional findOneAndUpdate is the atomicity boundary there. */
  const _locks = new Map();
  function withLock(key, fn) {
    const prev = _locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    _locks.set(key, next.catch(() => {}));
    return next;
  }

  /* Basic shape check only — this module never validates that an address is
   * actually well-formed for its network (that's the operator's own wallet's
   * job when they generate it); this just rejects obviously-wrong pastes
   * (empty lines, whitespace) so the pool doesn't fill with garbage. */
  function sanitizeList(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);
    const seen = new Set();
    const out = [];
    let inBatchDuplicates = 0;
    for (const a of list) {
      const addr = String(a || '').trim();
      if (!addr || addr.length < 10 || addr.length > 128) continue;
      if (seen.has(addr)) { inBatchDuplicates++; continue; }
      seen.add(addr);
      out.push(addr);
    }
    return { list: out, inBatchDuplicates };
  }

  async function addAddresses(network, rawList) {
    const { list: addrs, inBatchDuplicates } = sanitizeList(rawList);
    if (!addrs.length) return { added: 0, duplicates: inBatchDuplicates };
    const now = new Date();
    let added = 0;
    // Repeats within the same paste are duplicates too, not just repeats
    // against what's already in the pool — count both the same way so the
    // reported total is honest about every input line's fate.
    let duplicates = inBatchDuplicates;
    if (memory) {
      for (const address of addrs) {
        const exists = [...memory.cryptoAddresses.values()].some(d => d.network === network && d.address === address);
        if (exists) { duplicates++; continue; }
        const doc = { _id: crypto.randomBytes(12).toString('hex'), network, address, status: 'available', orderId: null, createdAt: now };
        memory.cryptoAddresses.set(doc._id, doc);
        added++;
      }
      return { added, duplicates };
    }
    for (const address of addrs) {
      const doc = { _id: crypto.randomBytes(12).toString('hex'), network, address, status: 'available', orderId: null, createdAt: now };
      try {
        await cryptoAddressesCol.insertOne(doc);
        added++;
      } catch (err) {
        if (err && err.code === 11000) { duplicates++; continue; }
        throw err;
      }
    }
    return { added, duplicates };
  }

  async function getForOrder(orderId) {
    if (memory) {
      for (const d of memory.cryptoAddresses.values()) if (d.orderId === orderId) return d;
      return null;
    }
    return cryptoAddressesCol.findOne({ orderId });
  }

  /* Atomically claim one available address for an order. Idempotent per
   * order — a retried checkout call gets back the SAME address, never a
   * second one (a buyer who refreshes must keep paying into the address
   * they were already shown). Returns { doc } or { empty: true }. */
  async function claimForOrder(network, orderId) {
    const existing = await getForOrder(orderId);
    if (existing) return { doc: existing };

    if (memory) {
      return withLock('claim:' + network, async () => {
        const again = await getForOrder(orderId);
        if (again) return { doc: again };
        let unit = null;
        for (const d of memory.cryptoAddresses.values()) {
          if (d.network === network && d.status === 'available') { unit = d; break; }
        }
        if (!unit) return { empty: true };
        unit.status = 'assigned';
        unit.orderId = orderId;
        unit.assignedAt = new Date();
        memory.cryptoAddresses.set(unit._id, unit);
        return { doc: unit };
      });
    }

    const res = await cryptoAddressesCol.findOneAndUpdate(
      { network, status: 'available' },
      { $set: { status: 'assigned', orderId, assignedAt: new Date() } },
      { returnDocument: 'after', sort: { createdAt: 1 } }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) return { empty: true };
    return { doc };
  }

  /* Return an order's claimed address to the pool — checkout cancelled or
   * the invoice expired unpaid. Never releases an address that already saw
   * a confirmed payment (callers check that themselves before releasing;
   * this module has no notion of "paid", only "claimed"). Idempotent. */
  async function releaseForOrder(orderId) {
    if (memory) {
      const d = await getForOrder(orderId);
      if (!d || d.status !== 'assigned') return { released: false };
      d.status = 'available';
      d.orderId = null;
      d.assignedAt = null;
      memory.cryptoAddresses.set(d._id, d);
      return { released: true };
    }
    const res = await cryptoAddressesCol.findOneAndUpdate(
      { orderId, status: 'assigned' },
      { $set: { status: 'available', orderId: null, assignedAt: null } },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    return { released: !!doc };
  }

  async function countAvailable(network) {
    if (memory) {
      let n = 0;
      for (const d of memory.cryptoAddresses.values()) if (d.network === network && d.status === 'available') n++;
      return n;
    }
    return cryptoAddressesCol.countDocuments({ network, status: 'available' });
  }

  async function poolStats(network) {
    if (memory) {
      let available = 0, assigned = 0;
      for (const d of memory.cryptoAddresses.values()) {
        if (d.network !== network) continue;
        if (d.status === 'available') available++;
        else if (d.status === 'assigned') assigned++;
      }
      return { network, available, assigned };
    }
    const [available, assigned] = await Promise.all([
      cryptoAddressesCol.countDocuments({ network, status: 'available' }),
      cryptoAddressesCol.countDocuments({ network, status: 'assigned' }),
    ]);
    return { network, available, assigned };
  }

  return { addAddresses, getForOrder, claimForOrder, releaseForOrder, countAvailable, poolStats };
}

module.exports = { createCryptoAddressStore };
