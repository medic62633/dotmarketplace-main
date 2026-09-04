/* Three fixes that share a theme: an endpoint doing more than the caller
 * should be able to make it do.
 *
 * - A conversation delete destroyed the thread, its messages and its uploaded
 *   images for BOTH sides, with no check on the deal's state — so either
 *   party could erase the record an arbiter reads when a dispute is opened.
 * - Creating a conversation accepted any existing account as the "seller", so
 *   any signed-in user could open a thread with any other user whose email
 *   they knew.
 * - Signup checked the address was free and then upserted, so two concurrent
 *   signups for one address both succeeded and the second replaced the first
 *   account outright.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing, fundedBuyer } = require('./helpers/fixtures');

async function makeBuyer(api, email) {
  await api('POST', '/api/auth/signup', { body: { email, password: 'test12345', name: 'Buyer' } });
  const s = await api('POST', '/api/auth/signin', { body: { email, password: 'test12345' } });
  return s.json.token;
}

const inbox = async (api, token) =>
  (await api('GET', '/api/conversations', { token })).json.conversations || [];

test('deleting a conversation hides it for the caller and leaves the other side\'s copy', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-msg@example.com', 'Seller');
  const buyerTok = await makeBuyer(api, 'buyer-msg@example.com');

  const conv = await api('POST', '/api/conversations', {
    token: buyerTok,
    body: { sellerName: 'Seller', sellerEmail: 'seller-msg@example.com', title: 'About your listing' },
  });
  assert.equal(conv.status, 200, JSON.stringify(conv.json));
  const convId = conv.json.conversation.id;
  await api('POST', `/api/conversations/${convId}/messages`, { token: buyerTok, body: { text: 'is this still available?' } });

  const del = await api('DELETE', `/api/conversations/${convId}`, { token: buyerTok });
  assert.equal(del.status, 200);
  assert.equal(del.json.purged, false, 'nothing is destroyed while the other side still has it');

  assert.equal((await inbox(api, buyerTok)).length, 0, 'gone from the deleter\'s inbox');
  const sellerInbox = await inbox(api, sellerTok);
  assert.equal(sellerInbox.length, 1, 'still in the counterparty\'s inbox');

  // And the messages themselves survive for them.
  const msgs = await api('GET', `/api/conversations/${convId}/messages`, { token: sellerTok });
  assert.equal(msgs.status, 200);
  assert.ok(msgs.json.messages.some(m => m.text === 'is this still available?'), 'the record is intact');
});

test('a deal chat is not destroyed while its escrow is live, even if both sides delete it', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-esc@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 50 });
  const buyerTok = await fundedBuyer(api, 'buyer-esc@example.com', 200);

  const dealId = 'DK-evidence-live';
  await api('POST', '/api/wallet/pay', { token: buyerTok, body: { dealId, listingId: item.id, title: item.title } });

  const conv = await api('POST', '/api/conversations', {
    token: buyerTok,
    body: { dealId, sellerName: 'Seller', sellerEmail: 'seller-esc@example.com', title: item.title },
  });
  const convId = conv.json.conversation.id;
  await api('POST', `/api/conversations/${convId}/messages`, { token: buyerTok, body: { text: 'evidence for the arbiter' } });

  // Both parties try to clear it while the money is still in escrow.
  await api('DELETE', `/api/conversations/${convId}`, { token: buyerTok });
  const second = await api('DELETE', `/api/conversations/${convId}`, { token: sellerTok });
  assert.equal(second.json.purged, false, 'a live escrow keeps the record');

  // An admin resolving the dispute can still read it.
  const disputes = await api('GET', '/api/admin/disputes', { token: admin });
  assert.equal(disputes.status, 200);
  const msgs = await api('GET', `/api/conversations/${convId}/messages`, { token: buyerTok });
  assert.ok(msgs.json.messages.some(m => m.text === 'evidence for the arbiter'), 'messages survive');
});

test('a new message brings a hidden thread back for whoever removed it', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-back@example.com', 'Seller');
  const buyerTok = await makeBuyer(api, 'buyer-back@example.com');

  const conv = await api('POST', '/api/conversations', {
    token: buyerTok, body: { sellerName: 'Seller', sellerEmail: 'seller-back@example.com' },
  });
  const convId = conv.json.conversation.id;
  await api('DELETE', `/api/conversations/${convId}`, { token: buyerTok });
  assert.equal((await inbox(api, buyerTok)).length, 0);

  await api('POST', `/api/conversations/${convId}/messages`, { token: sellerTok, body: { text: 'yes, still available' } });
  assert.equal((await inbox(api, buyerTok)).length, 1, 'the reply makes the thread visible again');
});

test('a conversation cannot be opened with someone who is not a seller', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const attacker = await makeBuyer(api, 'attacker@example.com');
  await makeBuyer(api, 'victim@example.com');
  const victim = await api('POST', '/api/auth/signin', { body: { email: 'victim@example.com', password: 'test12345' } });

  const conv = await api('POST', '/api/conversations', {
    token: attacker,
    body: { sellerName: 'Totally A Seller', sellerEmail: 'victim@example.com', title: 'hi' },
  });
  assert.notEqual(conv.status, 200, 'a plain buyer is not a messageable target');

  const victimInbox = await inbox(api, victim.json.token);
  assert.equal(victimInbox.length, 0, 'and nothing reaches their inbox');
});

test('a buyer can still start a thread with a real seller', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  await verifiedSeller(api, admin, 'seller-ok@example.com', 'Real Seller');
  const buyerTok = await makeBuyer(api, 'buyer-ok@example.com');

  const conv = await api('POST', '/api/conversations', {
    token: buyerTok,
    body: { sellerName: 'Real Seller', sellerEmail: 'seller-ok@example.com', title: 'About your listing' },
  });
  assert.equal(conv.status, 200, JSON.stringify(conv.json));
});

/* NOTE: this one documents intent rather than catching the regression. The
 * race it describes is Mongo-specific (check-then-upsert across a real
 * round-trip); against the in-memory store the blocking scryptSync in signup
 * serializes the requests, so the old code passes this too. The atomic form
 * itself is covered at the store level in
 * test/user-store-atomicity.test.js. */
test('concurrent signups for one address cannot replace an existing account', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const email = 'racer@example.com';
  const results = await Promise.all([
    api('POST', '/api/auth/signup', { body: { email, password: 'firstpass123', name: 'First' } }),
    api('POST', '/api/auth/signup', { body: { email, password: 'secondpass123', name: 'Second' } }),
    api('POST', '/api/auth/signup', { body: { email, password: 'thirdpass123', name: 'Third' } }),
  ]);
  const created = results.filter(r => r.status === 200);
  assert.equal(created.length, 1, 'exactly one signup creates the account');

  // Whoever won, only their password works — no later signup silently
  // replaced the account (which would have handed its email to someone else).
  const passwords = ['firstpass123', 'secondpass123', 'thirdpass123'];
  const working = [];
  for (const password of passwords) {
    const r = await api('POST', '/api/auth/signin', { body: { email, password } });
    if (r.status === 200) working.push(password);
  }
  assert.equal(working.length, 1, 'exactly one password is valid for the account');
});
