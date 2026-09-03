/* Server-authoritative buyer wallet.
 *
 * The wallet balance is owned entirely by the server — clients can read it and
 * request deposits / payments, but never set the number directly. All mutations
 * go through here so balances stay consistent and can't be forged from the
 * browser. Deal payments are atomic and idempotent per dealId.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const MAX_DEPOSIT = 100000;

function createWalletStore({ memory, walletsCol }) {
  /* Per-email promise chains serialize the read-modify-write in the memory
   * store. The memory path is check-then-act with awaits in between, so two
   * concurrent debits could otherwise both pass the balance check before either
   * saves. (Mongo uses a conditional atomic update and doesn't need this.) */
  const _locks = new Map();
  function withLock(email, fn) {
    const prev = _locks.get(email) || Promise.resolve();
    const next = prev.then(fn, fn); // run even if the prior op rejected
    _locks.set(email, next.catch(() => {}));
    return next;
  }

  async function getWallet(email, { session } = {}) {
    if (memory) return memory.wallets.get(email) || null;
    return walletsCol.findOne({ _id: email }, { session });
  }

  async function save(w, { session } = {}) {
    w.updatedAt = new Date();
    if (memory) {
      memory.wallets.set(w._id, w);
      return;
    }
    await walletsCol.replaceOne({ _id: w._id }, w, { upsert: true, session });
  }

  function blank(email) {
    return { _id: email, balance: 0, ledger: [], holds: [], createdAt: new Date(), updatedAt: new Date() };
  }

  async function ensureWallet(email, seedBalance, opts = {}) {
    let w = await getWallet(email, opts);
    if (!w) {
      w = blank(email);
      if (seedBalance) w.balance = round2(seedBalance);
      await save(w, opts);
    }
    return w;
  }

  async function getBalance(email) {
    const w = await getWallet(email);
    return w ? round2(w.balance || 0) : 0;
  }

  async function deposit(email, amount, lbl, opts = {}) {
    let amt = round2(amount);
    if (!Number.isFinite(amt) || amt <= 0) amt = 0;
    if (amt > MAX_DEPOSIT) amt = MAX_DEPOSIT;
    const w = await ensureWallet(email, undefined, opts);
    w.balance = round2((w.balance || 0) + amt);
    w.ledger = w.ledger || [];
    w.ledger.unshift({ type: 'deposit', amt, lbl: lbl || 'Deposit · USDT (TRC-20)', at: new Date() });
    w.ledger = w.ledger.slice(0, 200);
    await save(w, opts);
    return w;
  }

  /**
   * Atomically move funds from the wallet into escrow for a deal.
   * Returns { wallet } on success, { insufficient:true } if underfunded, or
   * { wallet, duplicate:true } if this dealId was already charged.
   */
  async function debitForDeal(email, { dealId, amount, lbl }) {
    const amt = round2(amount);
    if (!Number.isFinite(amt) || amt <= 0) return { invalid: true };

    if (memory) {
      // Serialize the check-and-debit per email so concurrent debits can't both
      // pass the balance check before either saves (see withLock above).
      return withLock(email, async () => {
        const w = await ensureWallet(email);
        w.holds = w.holds || [];
        if (dealId && holdFor(w, dealId)) return { wallet: w, duplicate: true };
        if (round2(w.balance || 0) + 1e-9 < amt) return { wallet: w, insufficient: true };
        w.balance = round2((w.balance || 0) - amt);
        if (dealId) w.holds.push({ dealId, amt });
        w.ledger = w.ledger || [];
        w.ledger.unshift({ type: 'hold', amt: -amt, lbl: lbl || ('Escrow hold · ' + dealId), dealId: dealId || null, at: new Date() });
        w.ledger = w.ledger.slice(0, 200);
        await save(w);
        return { wallet: w };
      });
    }

    // Mongo: ensure the doc exists, then do a single conditional atomic update
    // so concurrent requests can't overspend or double-charge a dealId.
    await walletsCol.updateOne(
      { _id: email },
      { $setOnInsert: { balance: 0, ledger: [], holds: [], createdAt: new Date() } },
      { upsert: true }
    );
    if (dealId) {
      const already = await walletsCol.findOne({ _id: email, 'holds.dealId': dealId });
      if (already) return { wallet: already, duplicate: true };
    }
    const entry = { type: 'hold', amt: -amt, lbl: lbl || ('Escrow hold · ' + dealId), dealId: dealId || null, at: new Date() };
    const filter = { _id: email, balance: { $gte: amt } };
    if (dealId) filter['holds.dealId'] = { $ne: dealId };
    const update = {
      $inc: { balance: -amt },
      $push: { ledger: { $each: [entry], $position: 0, $slice: 200 } },
      $set: { updatedAt: new Date() },
    };
    if (dealId) update.$push.holds = { dealId, amt };
    const res = await walletsCol.findOneAndUpdate(filter, update, { returnDocument: 'after' });
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) {
      // The conditional update failed for one of two reasons: balance too low,
      // or the pre-check raced a concurrent duplicate (the other request just
      // pushed this dealId's hold). Distinguish them — a duplicate must not
      // report "insufficient" when the buyer's payment actually succeeded.
      if (dealId) {
        const now = await walletsCol.findOne({ _id: email, 'holds.dealId': dealId });
        if (now) return { wallet: now, duplicate: true };
      }
      return { insufficient: true };
    }
    return { wallet: doc };
  }

  async function resetWallet(email) {
    const w = blank(email);
    await save(w);
    return w;
  }

  /* Holds are stored as { dealId, amt } so the amount is durable — recovering
   * it from the capped ledger breaks once the entry falls off the 200-entry
   * window. Legacy string entries (pre-migration wallets) are tolerated. */
  function holdFor(w, dealId) {
    if (!dealId || !w?.holds) return null;
    for (const h of w.holds) {
      if (h === dealId) return { dealId, amt: null };
      if (h && h.dealId === dealId) return { dealId, amt: round2(h.amt) || null };
    }
    return null;
  }

  /** Whether this buyer's wallet has an active hold for dealId. */
  async function hasHold(email, dealId) {
    if (!dealId) return false;
    const w = await getWallet(email);
    return !!holdFor(w, dealId);
  }

  /** The durable hold record ({ dealId, amt }) for dealId, or null. */
  async function getHold(email, dealId) {
    if (!dealId) return null;
    const w = await getWallet(email);
    return holdFor(w, dealId);
  }

  /** Remove dealId from holds after a refund so the buyer can pay again. */
  async function releaseHold(email, dealId, { session } = {}) {
    if (!dealId) return null;
    if (memory) {
      const w = await getWallet(email);
      if (!holdFor(w, dealId)) return w;
      w.holds = (w.holds || []).filter(h => !(h === dealId || (h && h.dealId === dealId)));
      await save(w);
      return w;
    }
    // Two pulls: object-form holds ({ dealId, amt }) and legacy string holds.
    await walletsCol.updateOne(
      { _id: email },
      { $pull: { holds: { dealId } }, $set: { updatedAt: new Date() } },
      { session }
    );
    const res = await walletsCol.findOneAndUpdate(
      { _id: email },
      { $pull: { holds: dealId }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after', session }
    );
    return res && (res.value !== undefined ? res.value : res);
  }

  function serialize(w) {
    if (!w) return { balance: 0, ledger: [] };
    return { balance: round2(w.balance || 0), ledger: (w.ledger || []).slice(0, 50) };
  }

  return { getWallet, ensureWallet, getBalance, deposit, debitForDeal, hasHold, getHold, releaseHold, resetWallet, serialize };
}

module.exports = { createWalletStore };
