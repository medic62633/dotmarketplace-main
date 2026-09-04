/* The profile-clobber bug lives on the Mongo path only: `replaceOne` writes a
 * whole document built from a read taken earlier, so a concurrent atomic $inc
 * is reverted. The in-memory store hands back the same object reference, so
 * read-modify-save is an in-place update there and the bug simply cannot
 * reproduce — which is exactly why the HTTP-level tests in
 * seller-profile-concurrency.test.js pass either way and cannot pin this.
 *
 * So this drives createSellerStore against a stand-in collection with Mongo's
 * actual semantics: documents are returned as COPIES, $inc/$set/$push apply
 * server-side to the stored document, and replaceOne overwrites it wholesale.
 * That is enough to show the clobber and to prove the fix removes it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSellerStore } = require('../lib/seller-store');

/* Minimal stand-in for a Mongo collection: enough of findOne /
 * findOneAndUpdate / replaceOne for the seller-profile paths, with copy-on-read
 * so callers can't mutate stored state by reference. */
function fakeCollection() {
  const docs = new Map();
  const clone = d => (d ? JSON.parse(JSON.stringify(d)) : null);

  function applyUpdate(doc, update) {
    for (const [field, val] of Object.entries(update.$set || {})) doc[field] = val;
    for (const [field, by] of Object.entries(update.$inc || {})) doc[field] = (doc[field] || 0) + by;
    for (const [field, spec] of Object.entries(update.$push || {})) {
      doc[field] = doc[field] || [];
      const items = spec?.$each || [spec];
      if (spec?.$position === 0) doc[field].unshift(...items);
      else doc[field].push(...items);
      if (typeof spec?.$slice === 'number') doc[field] = doc[field].slice(0, spec.$slice);
    }
    for (const field of Object.keys(update.$pull || {})) {
      if (Array.isArray(doc[field])) doc[field] = doc[field].filter(v => v !== update.$pull[field]);
    }
  }

  return {
    _docs: docs,
    async findOne(filter) { return clone(docs.get(filter._id)); },
    async findOneAndUpdate(filter, update) {
      const doc = docs.get(filter._id);
      if (!doc) return null;
      // Only the conditional forms these paths actually use.
      if (filter.balance?.$gte != null && !(doc.balance >= filter.balance.$gte)) return null;
      applyUpdate(doc, update);
      return clone(doc);
    },
    async replaceOne(filter, replacement) {
      docs.set(filter._id, clone(replacement));
      return { acknowledged: true };
    },
    async updateOne(filter, update) {
      const doc = docs.get(filter._id);
      if (!doc) return { matchedCount: 0 };
      applyUpdate(doc, update);
      return { matchedCount: 1 };
    },
    async find() { return { toArray: async () => [...docs.values()].map(clone) }; },
  };
}

function storeWithProfile(profile) {
  const col = fakeCollection();
  col._docs.set(profile._id, JSON.parse(JSON.stringify(profile)));
  const store = createSellerStore({
    memory: null,
    sellerProfilesCol: col,
    listingsCol: fakeCollection(),
    withdrawalsCol: fakeCollection(),
    escrowsCol: fakeCollection(),
    reviewsCol: fakeCollection(),
    mongoClient: null,
    txnSupported: false,
  });
  return { store, col };
}

const baseProfile = {
  _id: 'seller@example.com',
  name: 'Seller',
  verified: false,
  balance: 100,
  pendingEscrow: 0,
  totalEarnings: 100,
  deals: 1,
  ledger: [{ type: 'payout', amt: 100 }],
  withdrawAddress: '',
};

test('the whole-document write is what loses money (why updateSellerProfileFields exists)', async () => {
  const { store, col } = storeWithProfile(baseProfile);

  // A caller reads the profile, intending to change one unrelated field.
  const snapshot = await store.getSellerProfile('seller@example.com');

  // A payout lands in the gap — an atomic $inc, exactly as creditSellerPayout does.
  await col.updateOne({ _id: 'seller@example.com' }, {
    $inc: { balance: 50, totalEarnings: 50, deals: 1 },
    $push: { ledger: { $each: [{ type: 'payout', amt: 50 }], $position: 0, $slice: 200 } },
  });

  // The old pattern: mutate the stale snapshot and write it all back.
  snapshot.withdrawAddress = 'TNewAddress';
  await store.saveSellerProfile(snapshot);

  const after = await store.getSellerProfile('seller@example.com');
  assert.equal(after.balance, 100, 'the 50 payout is gone — this is the bug the helper avoids');
  assert.equal(after.ledger.length, 1, 'and so is its ledger entry');
});

test('updateSellerProfileFields leaves a concurrent payout intact', async () => {
  const { store, col } = storeWithProfile(baseProfile);

  await store.getSellerProfile('seller@example.com'); // same stale read as above

  await col.updateOne({ _id: 'seller@example.com' }, {
    $inc: { balance: 50, totalEarnings: 50, deals: 1 },
    $push: { ledger: { $each: [{ type: 'payout', amt: 50 }], $position: 0, $slice: 200 } },
  });

  await store.updateSellerProfileFields('seller@example.com', { withdrawAddress: 'TNewAddress' });

  const after = await store.getSellerProfile('seller@example.com');
  assert.equal(after.balance, 150, 'the payout survives');
  assert.equal(after.totalEarnings, 150);
  assert.equal(after.deals, 2);
  assert.equal(after.ledger.length, 2, 'including its ledger entry');
  assert.equal(after.withdrawAddress, 'TNewAddress', 'and the intended change still applied');
});

test('updateSellerProfileFields cannot be used to rewrite the profile key', async () => {
  const { store } = storeWithProfile(baseProfile);
  await store.updateSellerProfileFields('seller@example.com', { _id: 'attacker@example.com', verified: true });
  const after = await store.getSellerProfile('seller@example.com');
  assert.equal(after._id, 'seller@example.com', 'the key is never writable');
  assert.equal(after.verified, true, 'the legitimate field still applied');
});
