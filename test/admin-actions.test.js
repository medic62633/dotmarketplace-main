/* Regression coverage for the two admin-panel bugs found during manual QA:
 * withdrawal approval silently required a txHash the UI never sent, and
 * pending sellers had no way to be verified at all. These pin the backend
 * contract so a future change can't reintroduce either failure mode. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing, fundedBuyer } = require('./helpers/fixtures');

test('withdrawal approval requires an on-chain tx hash, and succeeds once one is provided', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'dana@example.com', 'Dana');
  const item = await listing(api, sellerTok);
  const buyerTok = await fundedBuyer(api, 'buyer4@example.com', 100);

  const dealId = 'D-withdraw-' + Date.now();
  await api('POST', '/api/wallet/pay', { token: buyerTok, body: { dealId, listingId: item.id, title: item.title } });
  await api('POST', '/api/seller/deliver', { token: sellerTok, body: { dealId } });
  await api('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });

  await api('PUT', '/api/seller/withdraw-address', { token: sellerTok, body: { address: 'TAbcdefghijkmnopqrstuvwxyzABCDEFG1' } });
  const req = await api('POST', '/api/seller/withdrawals', { token: sellerTok, body: { amount: 10 } });
  assert.equal(req.status, 200, JSON.stringify(req.json));
  const withdrawalId = req.json.withdrawal?.id || req.json.id;

  const list = await api('GET', '/api/admin/withdrawals', { token: admin });
  const pending = list.json.withdrawals.find(w => w.status === 'pending');
  assert.ok(pending, 'the request shows up as pending for the admin');

  const withoutHash = await api('POST', '/api/admin/withdrawals/' + pending.id + '/approve', { token: admin, body: {} });
  assert.equal(withoutHash.status, 400, 'approval without a tx hash must be rejected, not silently accepted');

  const withHash = await api('POST', '/api/admin/withdrawals/' + pending.id + '/approve', { token: admin, body: { txHash: '0xtesthash1234' } });
  assert.equal(withHash.status, 200, JSON.stringify(withHash.json));
  assert.equal(withHash.json.withdrawal.status, 'completed');
});

test('a pending seller can be verified by an admin, and shows as verified afterward', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  // Create a seller via invite (auto-verified), then revoke to get to the
  // pending state a freshly-applied seller would also be in.
  await verifiedSeller(api, admin, 'eve@example.com', 'Eve');
  await api('POST', '/api/admin/sellers/eve@example.com/reject', { token: admin });

  const before = await api('GET', '/api/admin/sellers', { token: admin });
  const eveBefore = before.json.sellers.find(s => s.email === 'eve@example.com');
  assert.equal(eveBefore.verified, false);

  const verify = await api('POST', '/api/admin/sellers/eve@example.com/verify', { token: admin });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));

  const after = await api('GET', '/api/admin/sellers', { token: admin });
  const eveAfter = after.json.sellers.find(s => s.email === 'eve@example.com');
  assert.equal(eveAfter.verified, true);
});
