const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing, fundedBuyer } = require('./helpers/fixtures');

test('wallet top-up, escrow hold, deliver, and buyer-confirmed release', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'anna@example.com', 'Anna');
  const item = await listing(api, sellerTok);
  const buyerTok = await fundedBuyer(api, 'buyer1@example.com', 100);

  const wallet = (await api('GET', '/api/wallet', { token: buyerTok })).json.wallet;
  assert.equal(wallet.balance, 100, 'simulated top-up credits the full amount');

  const dealId = 'D-test-' + Date.now();
  const pay = await api('POST', '/api/wallet/pay', {
    token: buyerTok,
    body: { dealId, listingId: item.id, title: item.title },
  });
  assert.equal(pay.status, 200, 'purchase succeeds: ' + JSON.stringify(pay.json));
  assert.equal(pay.json.wallet.balance, 75, 'listing price is held from the buyer wallet');

  const deliver = await api('POST', '/api/seller/deliver', { token: sellerTok, body: { dealId } });
  assert.equal(deliver.status, 200);
  assert.equal(deliver.json.escrow.status, 'delivered');

  const payout = await api('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });
  assert.equal(payout.status, 200, 'buyer confirm releases escrow: ' + JSON.stringify(payout.json));
  assert.ok(payout.json.net < 25 && payout.json.net > 20, 'seller net is the price minus platform fee');
});

test('wallet/pay rejects an amount below wallet balance with 402, not a partial charge', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'bob@example.com', 'Bob');
  const item = await listing(api, sellerTok, { price: 500 });
  const buyerTok = await fundedBuyer(api, 'buyer2@example.com', 10);

  const pay = await api('POST', '/api/wallet/pay', {
    token: buyerTok,
    body: { dealId: 'D-insufficient-' + Date.now(), listingId: item.id, title: item.title },
  });
  assert.equal(pay.status, 402);
  assert.equal(pay.json.error, 'insufficient');

  const wallet = (await api('GET', '/api/wallet', { token: buyerTok })).json.wallet;
  assert.equal(wallet.balance, 10, 'a rejected purchase never touches the wallet balance');
});

test('a disputed escrow can be released to the seller or refunded to the buyer by an admin', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'carol@example.com', 'Carol');
  const item = await listing(api, sellerTok);
  const buyerTok = await fundedBuyer(api, 'buyer3@example.com', 100);

  // Deal 1: disputed then released to the seller.
  const dealA = 'D-dispute-release-' + Date.now();
  await api('POST', '/api/wallet/pay', { token: buyerTok, body: { dealId: dealA, listingId: item.id, title: item.title } });
  await api('POST', '/api/seller/deliver', { token: sellerTok, body: { dealId: dealA } });
  const disputeA = await api('POST', '/api/seller/dispute', { token: buyerTok, body: { dealId: dealA, reason: 'not as described' } });
  assert.equal(disputeA.status, 200);

  const resolveRelease = await api('POST', '/api/admin/disputes/' + dealA + '/resolve', { token: admin, body: { resolution: 'release' } });
  assert.equal(resolveRelease.status, 200);
  assert.equal(resolveRelease.json.resolution, 'release');

  // Deal 2: disputed then refunded to the buyer.
  const dealB = 'D-dispute-refund-' + Date.now();
  await api('POST', '/api/wallet/pay', { token: buyerTok, body: { dealId: dealB, listingId: item.id, title: item.title } });
  await api('POST', '/api/seller/deliver', { token: sellerTok, body: { dealId: dealB } });
  await api('POST', '/api/seller/dispute', { token: buyerTok, body: { dealId: dealB, reason: 'never received' } });

  const balanceBefore = (await api('GET', '/api/wallet', { token: buyerTok })).json.wallet.balance;
  const resolveRefund = await api('POST', '/api/admin/disputes/' + dealB + '/resolve', { token: admin, body: { resolution: 'refund' } });
  assert.equal(resolveRefund.status, 200);
  assert.equal(resolveRefund.json.resolution, 'refund');

  const balanceAfter = (await api('GET', '/api/wallet', { token: buyerTok })).json.wallet.balance;
  assert.equal(balanceAfter, balanceBefore + item.price, 'a refund returns the full escrowed amount to the buyer');

  // The dispute queue should be empty now that both were resolved.
  const disputes = await api('GET', '/api/admin/disputes', { token: admin });
  assert.equal(disputes.json.disputes.length, 0);
});

test('a refunded escrow can never be released to the seller (double-spend guard)', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'dana@example.com', 'Dana');
  const item = await listing(api, sellerTok);
  const buyerTok = await fundedBuyer(api, 'buyer4@example.com', 100);

  const earningsBefore = (await api('GET', '/api/seller/dashboard', { token: sellerTok })).json;

  // Fund, deliver, dispute, and refund the deal back to the buyer.
  const dealId = 'D-refund-guard-' + Date.now();
  await api('POST', '/api/wallet/pay', { token: buyerTok, body: { dealId, listingId: item.id, title: item.title } });
  await api('POST', '/api/seller/deliver', { token: sellerTok, body: { dealId } });
  await api('POST', '/api/seller/dispute', { token: buyerTok, body: { dealId, reason: 'never received' } });
  const refund = await api('POST', '/api/admin/disputes/' + dealId + '/resolve', { token: admin, body: { resolution: 'refund' } });
  assert.equal(refund.status, 200);

  // Buyer (or an admin re-resolving the other way) now tries to release the
  // same escrow to the seller — it must be a duplicate, never a payout.
  const payout = await api('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });
  assert.equal(payout.status, 200);
  assert.equal(payout.json.duplicate, true, 'release-after-refund is rejected as duplicate');
  assert.equal(payout.json.net, undefined, 'no seller payout is issued');

  const reresolve = await api('POST', '/api/admin/disputes/' + dealId + '/resolve', { token: admin, body: { resolution: 'release' } });
  assert.notEqual(reresolve.status, 200, 'admin cannot re-resolve a refunded escrow the other way');

  const earningsAfter = (await api('GET', '/api/seller/dashboard', { token: sellerTok })).json;
  assert.equal(earningsAfter.profile.balance, earningsBefore.profile.balance, 'seller balance untouched');
  assert.equal(earningsAfter.profile.totalEarnings, earningsBefore.profile.totalEarnings, 'seller earnings untouched by the refund');
});
