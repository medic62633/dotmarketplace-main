/* Signup's uniqueness check is only as good as its atomicity.
 *
 * It used to read with getUser and then write with putUser — a replaceOne
 * upsert. Two concurrent signups for the same address both passed the read
 * and both wrote, so the second REPLACED the first account: same email, a
 * different person's password and token. The _id is the address, so an
 * insert is the atomic form of that check.
 *
 * The HTTP-level test in messaging-and-signup.test.js cannot pin this — the
 * in-memory store's blocking scryptSync serializes the requests, so the race
 * never opens there. This drives the store against a collection with Mongo's
 * duplicate-key behaviour instead.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/* Stand-in with the one Mongo behaviour that matters here: insertOne rejects
 * a duplicate _id with code 11000, while replaceOne+upsert overwrites. */
function fakeUsers() {
  const docs = new Map();
  return {
    docs,
    async findOne(filter) { return docs.get(filter._id) || null; },
    async insertOne(doc) {
      if (docs.has(doc._id)) {
        const err = new Error('E11000 duplicate key error');
        err.code = 11000;
        throw err;
      }
      docs.set(doc._id, { ...doc });
      return { insertedId: doc._id };
    },
    async replaceOne(filter, doc) {
      docs.set(filter._id, { ...doc });
      return { acknowledged: true };
    },
  };
}

/* The two implementations, side by side — the store module builds `store` in
 * server.js, which is not importable on its own, so the semantics under test
 * are reproduced here against the same fake. */
const oldCheckThenPut = async (col, user) => {
  const existing = await col.findOne({ _id: user._id });
  if (existing) return false;
  await col.replaceOne({ _id: user._id }, user); // upsert
  return true;
};

const newInsertIfAbsent = async (col, user) => {
  try {
    await col.insertOne(user);
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false;
    throw err;
  }
};

/** Both callers read before either writes — the interleaving a real DB allows. */
async function raceTwoSignups(col, impl) {
  const first = { _id: 'race@example.com', passHash: 'FIRST', token: 'token-first' };
  const second = { _id: 'race@example.com', passHash: 'SECOND', token: 'token-second' };
  const a = impl(col, first);
  const b = impl(col, second);
  return { results: await Promise.all([a, b]), stored: col.docs.get('race@example.com') };
}

test('the check-then-upsert form lets a second signup replace the first account', async () => {
  const col = fakeUsers();
  const { results, stored } = await raceTwoSignups(col, oldCheckThenPut);
  assert.deepEqual(results, [true, true], 'both signups believe they succeeded');
  assert.equal(stored.passHash, 'SECOND', 'and the first account was overwritten — the bug');
});

test('createUserIfAbsent lets exactly one signup win', async () => {
  const col = fakeUsers();
  const { results, stored } = await raceTwoSignups(col, newInsertIfAbsent);
  assert.deepEqual(results.filter(Boolean).length, 1, 'exactly one signup creates the account');
  assert.equal(stored.passHash, 'FIRST', 'and the winner keeps it');
  assert.equal(stored.token, 'token-first');
});

test('server.js wires signup to the atomic form', async () => {
  // Guards the call site, not just the helper: signup must not drift back to
  // getUser-then-putUser.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const signup = src.slice(src.indexOf("app.post('/api/auth/signup'"), src.indexOf("app.post('/api/auth/verify-email'"));
  assert.ok(signup.includes('createUserIfAbsent'), 'signup uses the atomic create');
  assert.ok(!/if \(await store\.getUser\(id\)\) return res\.status\(409\)/.test(signup),
    'and no longer gates on a separate read');
});
