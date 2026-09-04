/* Order/deal ids arrive from the client and key the escrow, the payment
 * record, the deal conversation and the stock reservation. They used to be
 * 'DK-' + a random 1000..9999 generated in the browser and deduped only
 * against that browser's own deals — 9,000 values shared by every buyer on
 * the platform.
 *
 * When two buyers landed on the same one, the second buyer's wallet was
 * debited while the escrow, the payment record and the seller-side sale all
 * stayed bound to the first buyer's deal: money out, HTTP 200, and nothing of
 * their own to release, dispute or refund.
 *
 * The ids are 64-bit random now, but the server no longer trusts that — it
 * binds each id to the first buyer who uses it. These tests pin that server
 * side of the fix, since it's the half that holds against a forged id.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing, fundedBuyer } = require('./helpers/fixtures');

async function setup() {
  const srv = await startServer();
  const admin = await adminToken(srv.api);
  const sellerA = await verifiedSeller(srv.api, admin, 'seller-a@test.com', 'Seller A');
  const sellerB = await verifiedSeller(srv.api, admin, 'seller-b@test.com', 'Seller B');
  const listingA = await listing(srv.api, sellerA, { title: 'Listing A', price: 40 });
  const listingB = await listing(srv.api, sellerB, { title: 'Listing B', price: 25 });
  const buyer1 = await fundedBuyer(srv.api, 'buyer-one@test.com', 200);
  const buyer2 = await fundedBuyer(srv.api, 'buyer-two@test.com', 200);
  return { srv, admin, listingA, listingB, buyer1, buyer2 };
}

const balanceOf = async (api, token) =>
  (await api('GET', '/api/wallet', { token })).json.wallet.balance;

test('a second buyer cannot pay on an order id that already belongs to someone else', async (t) => {
  const { srv, listingA, listingB, buyer1, buyer2 } = await setup();
  t.after(() => srv.stop());

  const DEAL_ID = 'DK-collision-test';

  const first = await srv.api('POST', '/api/wallet/pay', {
    token: buyer1, body: { dealId: DEAL_ID, listingId: listingA.id, title: 'Listing A' },
  });
  assert.equal(first.status, 200, 'the first buyer pays normally');

  const before = await balanceOf(srv.api, buyer2);
  const second = await srv.api('POST', '/api/wallet/pay', {
    token: buyer2, body: { dealId: DEAL_ID, listingId: listingB.id, title: 'Listing B' },
  });
  const after = await balanceOf(srv.api, buyer2);

  assert.equal(second.status, 409, 'the colliding purchase is refused');
  assert.equal(second.json.error, 'order_taken');
  assert.equal(after, before, 'and — the whole point — the second buyer is not charged');
});

/* The failure this whole change exists to prevent: money leaving a buyer's
 * wallet with no record anywhere that it was theirs. Asserting "buyer2 has no
 * records" alone would pass against the OLD code too — that was precisely the
 * bug — so the charge and the records have to be asserted together. */
test('a refused collision never leaves a buyer charged with no record of the purchase', async (t) => {
  const { srv, admin, listingA, listingB, buyer1, buyer2 } = await setup();
  t.after(() => srv.stop());

  const DEAL_ID = 'DK-collision-records';
  await srv.api('POST', '/api/wallet/pay', {
    token: buyer1, body: { dealId: DEAL_ID, listingId: listingA.id, title: 'Listing A' },
  });

  const before = await balanceOf(srv.api, buyer2);
  await srv.api('POST', '/api/wallet/pay', {
    token: buyer2, body: { dealId: DEAL_ID, listingId: listingB.id, title: 'Listing B' },
  });
  const charged = before - (await balanceOf(srv.api, buyer2));

  const orders = (await srv.api('GET', '/api/admin/orders', { token: admin })).json.orders || [];
  const buyer2Orders = orders.filter(o => o.buyerEmail === 'buyer-two@test.com');

  // Either outcome is coherent; being charged with nothing to show is not.
  if (charged > 0) {
    assert.ok(buyer2Orders.length > 0, `buyer2 was charged ${charged} but has no order record`);
  } else {
    assert.equal(buyer2Orders.length, 0, 'not charged, so no order record should exist');
  }

  const forDeal = orders.filter(o => o.orderId === DEAL_ID);
  assert.equal(forDeal.length, 1, 'exactly one order exists under the id');
  assert.equal(forDeal[0].buyerEmail, 'buyer-one@test.com', 'and it is the original buyer\'s');
  assert.equal(forDeal[0].amount, 40, 'with the original listing\'s amount, not the second one\'s');
});

test('the crypto checkout path refuses another buyer\'s order id too', async (t) => {
  const { srv, listingA, listingB, buyer1, buyer2 } = await setup();
  t.after(() => srv.stop());

  const DEAL_ID = 'DK-collision-crypto';
  await srv.api('POST', '/api/wallet/pay', {
    token: buyer1, body: { dealId: DEAL_ID, listingId: listingA.id, title: 'Listing A' },
  });

  const r = await srv.api('POST', '/api/payments/escrow', {
    token: buyer2,
    body: { orderId: DEAL_ID, listingId: listingB.id, method: 'crypto', title: 'Listing B' },
  });
  assert.equal(r.status, 409, 'refused on ownership, ahead of any provider-configured check');
  assert.equal(r.json.error, 'order_taken');
});

test('the owning buyer can still retry their own order id without being charged twice', async (t) => {
  const { srv, listingA, buyer1 } = await setup();
  t.after(() => srv.stop());

  const DEAL_ID = 'DK-idempotent-retry';
  const first = await srv.api('POST', '/api/wallet/pay', {
    token: buyer1, body: { dealId: DEAL_ID, listingId: listingA.id, title: 'Listing A' },
  });
  assert.equal(first.status, 200);
  const afterFirst = await balanceOf(srv.api, buyer1);

  // The retry a double-click or a flaky connection produces. The order id is
  // the idempotency key, so this must stay a no-op rather than being caught by
  // the new ownership check.
  const retry = await srv.api('POST', '/api/wallet/pay', {
    token: buyer1, body: { dealId: DEAL_ID, listingId: listingA.id, title: 'Listing A' },
  });
  assert.equal(retry.status, 200, 'the buyer\'s own retry still succeeds');
  assert.equal(retry.json.duplicate, true, 'and is reported as a duplicate');
  assert.equal(await balanceOf(srv.api, buyer1), afterFirst, 'with no second charge');
});
