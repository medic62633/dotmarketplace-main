function createPaymentStore({ memory, paymentsCol }) {
  const crypto = require('crypto');

  /**
   * Atomically claim an orderId before minting a provider invoice. Without
   * this, two concurrent first checkouts both read "no record", both mint
   * live invoices at the provider, and one dies on the unique orderId index
   * AFTER money may be in flight (orphaned invoice, stranded funds).
   * Winner gets { won: true, doc, prevStatus } and MUST finish with save() or
   * releaseCheckout(); a concurrent loser gets { won: false } and should 409.
   */
  async function claimCheckout(orderId, buyerEmail) {
    // A claim older than this is assumed crashed (its owner never finished or
    // released) and may be taken over — otherwise one dead attempt wedges the
    // orderId behind a permanent 'creating' placeholder.
    const STALE_MS = 2 * 60 * 1000;
    const staleBefore = new Date(Date.now() - STALE_MS);
    if (memory) {
      for (const p of memory.payments.values()) {
        if (p.orderId === orderId) {
          if (p.status === 'creating' && new Date(p.updatedAt) >= staleBefore) return { won: false, doc: p };
          const prevStatus = p.status === 'creating' ? (p._prevStatus || null) : p.status;
          p._prevStatus = prevStatus;
          p.status = 'creating';
          p.updatedAt = new Date();
          return { won: true, doc: p, prevStatus };
        }
      }
      const doc = {
        _id: crypto.randomBytes(12).toString('hex'),
        orderId,
        buyerEmail,
        status: 'creating',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memory.payments.set(doc._id, doc);
      return { won: true, doc, prevStatus: null };
    }
    try {
      const res = await paymentsCol.findOneAndUpdate(
        {
          orderId,
          $or: [
            { status: { $ne: 'creating' } },
            { status: 'creating', updatedAt: { $lt: staleBefore } },
          ],
        },
        {
          $set: { status: 'creating', updatedAt: new Date() },
          $setOnInsert: {
            _id: crypto.randomBytes(12).toString('hex'),
            orderId,
            buyerEmail,
            createdAt: new Date(),
          },
        },
        { upsert: true, returnDocument: 'before' }
      );
      const before = res && (res.value !== undefined ? res.value : res);
      const doc = before || await paymentsCol.findOne({ orderId });
      return { won: true, doc, prevStatus: before ? before.status : null };
    } catch (err) {
      // Unique-index race: the other concurrent claim inserted first.
      if (String(err?.code) === '11000' || /duplicate key/i.test(String(err?.message))) {
        return { won: false, doc: await paymentsCol.findOne({ orderId }) };
      }
      throw err;
    }
  }

  /* Undo a won claim when invoice minting fails: restore the previous record
   * state, or remove the fresh placeholder so the buyer can retry cleanly. */
  async function releaseCheckout(orderId, prevStatus) {
    if (memory) {
      for (const p of memory.payments.values()) {
        if (p.orderId === orderId && p.status === 'creating') {
          if (prevStatus) { p.status = prevStatus; delete p._prevStatus; }
          else memory.payments.delete(p._id);
        }
      }
      return;
    }
    if (prevStatus) {
      await paymentsCol.updateOne({ orderId, status: 'creating' }, { $set: { status: prevStatus, updatedAt: new Date() } });
    } else {
      await paymentsCol.deleteOne({ orderId, status: 'creating' });
    }
  }

  async function getByOrderId(orderId) {
    if (memory) {
      for (const p of memory.payments.values()) {
        if (p.orderId === orderId) return p;
      }
      return null;
    }
    return paymentsCol.findOne({ orderId });
  }

  async function getById(id) {
    if (memory) return memory.payments.get(id) || null;
    return paymentsCol.findOne({ _id: id });
  }

  async function save(doc, { session } = {}) {
    doc.updatedAt = new Date();
    if (memory) {
      memory.payments.set(doc._id, doc);
      return;
    }
    await paymentsCol.replaceOne({ _id: doc._id }, doc, { upsert: true, session });
  }

  /**
   * Atomically transition a payment to `paid`. Only one caller wins — webhook
   * redelivery and poll races cannot double-credit the wallet or double-hold escrow.
   * Returns { claimed: true, doc } on first success, { claimed: false, doc } if
   * already paid or missing.
   */
  async function claimPaid(id, extraPatch = {}) {
    const patch = {
      ...extraPatch,
      status: 'paid',
      paidAt: extraPatch.paidAt || new Date(),
      updatedAt: new Date(),
    };
    delete patch._id;

    if (memory) {
      const doc = memory.payments.get(id);
      if (!doc) return { claimed: false, doc: null };
      if (doc.status === 'paid') return { claimed: false, doc };
      Object.assign(doc, patch);
      memory.payments.set(id, doc);
      return { claimed: true, doc };
    }

    const res = await paymentsCol.findOneAndUpdate(
      { _id: id, status: { $ne: 'paid' } },
      { $set: patch },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) {
      const cur = await getById(id);
      return { claimed: false, doc: cur };
    }
    return { claimed: true, doc };
  }

  async function listRecent(limit = 50) {
    if (memory) {
      return [...memory.payments.values()]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }
    return paymentsCol.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  async function listBySeller(sellerEmail, limit = 50) {
    if (memory) {
      return [...memory.payments.values()]
        .filter(p => p.sellerEmail === sellerEmail)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }
    return paymentsCol.find({ sellerEmail }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  async function listByBuyer(buyerEmail, limit = 100) {
    if (memory) {
      return [...memory.payments.values()]
        .filter(p => p.buyerEmail === buyerEmail)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }
    return paymentsCol.find({ buyerEmail }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  /* Atomically flip a non-paid payment to a terminal status ('expired' or
   * 'cancelled'). Only one caller wins and a paid/refunded record can never be
   * clobbered, so an invoice that confirms at the provider the same instant the
   * TTL fires keeps its money. Returns { claimed, doc }. */
  async function claimTerminal(id, status) {
    const patch = { status, updatedAt: new Date() };
    if (status === 'expired') patch.expiredAt = new Date();
    if (status === 'cancelled') patch.cancelledAt = new Date();
    const guard = { _id: id, status: { $nin: ['paid', 'expired', 'cancelled'] }, refundStatus: { $exists: false } };
    if (memory) {
      const doc = memory.payments.get(id);
      if (!doc) return { claimed: false, doc: null };
      if (['paid', 'expired', 'cancelled'].includes(doc.status) || doc.refundStatus) return { claimed: false, doc };
      Object.assign(doc, patch);
      memory.payments.set(id, doc);
      return { claimed: true, doc };
    }
    const res = await paymentsCol.findOneAndUpdate(guard, { $set: patch }, { returnDocument: 'after' });
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) return { claimed: false, doc: await getById(id) };
    return { claimed: true, doc };
  }

  return { getByOrderId, getById, save, claimPaid, claimTerminal, claimCheckout, releaseCheckout, listRecent, listBySeller, listByBuyer };
}

module.exports = { createPaymentStore };
