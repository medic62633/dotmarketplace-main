/* A seller profile carries live money — balance, pendingEscrow,
 * totalEarnings, deals, and the ledger — moved by atomic $inc from
 * creditSellerPayout and friends.
 *
 * Several routes changed one unrelated field on that profile by reading the
 * whole document, mutating it, and writing it all back. Anything that landed
 * in the gap was silently reverted: a payout credit and its ledger entry
 * simply disappeared. The withdrawal path was the worst, writing back a
 * snapshot taken BEFORE its own debit.
 *
 * These pin that a field update no longer disturbs the money on the same
 * document.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing, fundedBuyer } = require('./helpers/fixtures');

const TRC20 = 'TQ1n7yPy8hHqR4mVkKq1PjWnLpXk8sT7bZ';

/** Buy `item` and release the escrow, leaving the seller with a real payout. */
async function buyAndRelease(api, buyerTok, item, dealId) {
  const pay = await api('POST', '/api/wallet/pay', {
    token: buyerTok, body: { dealId, listingId: item.id, title: item.title },
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  const rel = await api('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });
  assert.equal(rel.status, 200, JSON.stringify(rel.json));
  return rel.json;
}

const profileOf = async (api, sellerTok) =>
  (await api('GET', '/api/seller/dashboard', { token: sellerTok })).json.profile;

test('setting a withdrawal address does not revert a payout credited alongside it', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-conc@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 100 });
  const buyerTok = await fundedBuyer(api, 'buyer-conc@example.com', 500);

  await buyAndRelease(api, buyerTok, item, 'DK-payout-before-addr');
  const afterPayout = await profileOf(api, sellerTok);
  assert.ok(afterPayout.balance > 0, 'seller has a real balance to lose');

  // The address update used to write the whole profile back.
  const addr = await api('PUT', '/api/seller/withdraw-address', {
    token: sellerTok, body: { address: TRC20 },
  });
  assert.equal(addr.status, 200, JSON.stringify(addr.json));

  const after = await profileOf(api, sellerTok);
  assert.equal(after.balance, afterPayout.balance, 'the payout survives the address write');
  assert.equal(after.withdrawAddress, TRC20, 'and the address actually changed');
});

test('a payout landing during a withdrawal is not erased by it', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-race@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 100 });
  const buyerTok = await fundedBuyer(api, 'buyer-race@example.com', 500);

  // First sale, released — the seller can now withdraw against it.
  await buyAndRelease(api, buyerTok, item, 'DK-race-first');
  const before = await profileOf(api, sellerTok);

  // A withdrawal (which supplies a new address, so it writes the profile) and
  // a second payout, fired together. Whatever order they land in, the ending
  // balance must account for both: the debit and both credits.
  const [, second] = await Promise.all([
    api('POST', '/api/seller/withdrawals', {
      token: sellerTok, body: { amount: 10, address: TRC20 },
    }),
    buyAndRelease(api, buyerTok, item, 'DK-race-second'),
  ]);

  const after = await profileOf(api, sellerTok);
  const expected = Math.round((before.balance - 10 + second.net) * 100) / 100;
  assert.equal(after.balance, expected,
    `balance must be ${expected} (started ${before.balance}, -10 withdrawn, +${second.net} paid out)`);
});

test('an admin verifying a seller does not revert their balance', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-verify@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 100 });
  const buyerTok = await fundedBuyer(api, 'buyer-verify@example.com', 500);

  await buyAndRelease(api, buyerTok, item, 'DK-verify-payout');
  const before = await profileOf(api, sellerTok);
  assert.ok(before.balance > 0);

  const verify = await api('POST', '/api/admin/sellers/seller-verify@example.com/verify', { token: admin });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));

  const after = await profileOf(api, sellerTok);
  assert.equal(after.balance, before.balance, 'admin verify leaves the money alone');
});

test('leaving a review does not revert the payout that made it possible', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const sellerTok = await verifiedSeller(api, admin, 'seller-review@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 100 });
  const buyerTok = await fundedBuyer(api, 'buyer-review@example.com', 500);

  const dealId = 'DK-review-flow';
  await api('POST', '/api/wallet/pay', {
    token: buyerTok, body: { dealId, listingId: item.id, title: item.title },
  });
  await api('POST', '/api/seller/deliver', { token: sellerTok, body: { dealId, proof: 'sent' } });
  await api('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });
  const before = await profileOf(api, sellerTok);
  assert.ok(before.balance > 0);

  // A review is posted right after release — the tightest window there is.
  const review = await api('POST', '/api/reviews', {
    token: buyerTok, body: { dealId, rating: 5, text: 'great' },
  });
  assert.equal(review.status, 200, JSON.stringify(review.json));

  const after = await profileOf(api, sellerTok);
  assert.equal(after.balance, before.balance, 'the review write leaves the money alone');
  assert.equal(after.rate, 5, 'and the rating was actually recorded');
});
