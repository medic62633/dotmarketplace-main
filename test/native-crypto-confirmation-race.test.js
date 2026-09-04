/* Covers a real bug found auditing lib/payment-routes.js's syncProviderPayment:
 * once a native-chain transfer is observed for a pending record
 * (nativeFirstSeenAt set), it still has to wait out that provider's
 * confirmWindowMs() before being marked paid — and the code fell through to
 * the local-TTL-expiry check in the meantime. A buyer who paid right before
 * PENDING_TTL_MS elapsed (or who simply didn't have their tab open to poll
 * again until well after it elapsed) could have a real, already-detected
 * on-chain payment get marked 'expired' — releasing the deposit address back
 * into the pool for reassignment while real money sat on it, with no
 * remaining code path that ever credits or refunds it. The same fell-through
 * risk existed on /api/payments/cancel: a buyer could cancel an order out
 * from under a payment already detected but not yet confirmed.
 *
 * Exercises the real code path over real HTTP: a fake TronGrid server (this
 * process's own child spawns the real server.js, which makes the real
 * fetch() call — nothing here is mocked in-process) returns a matching
 * transfer, then this test manipulates only what a real clock would: how
 * long ago the order was created / first seen, via PAYMENT_PENDING_TTL_MS
 * and NATIVE_TRON_CONFIRM_SECONDS set small enough to observe both
 * transitions inside a normal test timeout. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing } = require('./helpers/fixtures');

/* Fake TronGrid: reports one qualifying USDT-TRC20 transfer of exactly
 * `microUnits` (raw integer, 6 decimals) into whatever address is asked
 * about — matches native-tron.js's expected response shape.
 *
 * The address has no history when the invoice is created (so the watermark
 * native-tron.js records is 0) and the transfer appears afterwards, dated
 * later than that watermark — which is what makes it count as payment for
 * THIS order rather than a leftover from whatever the pooled address did
 * before. `block_timestamp` is not optional: a transfer without one can't be
 * placed relative to the invoice and is ignored by design. */
function startFakeTronGrid(microUnits) {
  let firstRequestDone = false;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // The very first read is createInvoice capturing the watermark: the
      // address is still empty at that point.
      const body = firstRequestDone
        ? {
          data: [{
            value: String(microUnits),
            block_timestamp: Date.now(),
            transaction_id: 'fake-tx-1',
            from: 'TFakeSenderAddress00000000000000',
          }],
        }
        : { data: [] };
      firstRequestDone = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* Fake TronGrid reporting no transfers at all — for the "genuinely abandoned
 * checkout" case, where expiry SHOULD fire. */
function startEmptyFakeTronGrid() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('a detected-but-unconfirmed on-chain payment is never expired by TTL', async (t) => {
  const usdAmount = 10;
  const microUnits = Math.round(usdAmount * 1e6);
  const fakeTronGrid = await startFakeTronGrid(microUnits);
  t.after(() => fakeTronGrid.close());
  const fakePort = fakeTronGrid.address().port;

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_tron',
    NATIVE_TRON_API_BASE: `http://127.0.0.1:${fakePort}`,
    // Long enough that "waited >= confirmWindowMs" is false for the whole
    // test (we're proving the record survives that window without being
    // expired), short enough the test doesn't need to sleep long.
    NATIVE_TRON_CONFIRM_SECONDS: '5',
    // Shorter than the sleep below, so without the fix this checkout would
    // fall through to the TTL branch on the second status poll.
    PAYMENT_PENDING_TTL_MS: '300',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const addr = 'TAbcRaceTest0000000000000000000001';
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'tron-usdt-trc20', addresses: addr } });

  const sellerTok = await verifiedSeller(api, admin, 'seller-race@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: usdAmount });

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-race@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-race@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const orderId = 'ORD-RACE-' + Date.now();
  const create = await api('POST', '/api/payments/escrow', {
    token: buyerTok,
    body: { orderId, listingId: item.id, method: 'crypto' },
  });
  assert.equal(create.status, 200, JSON.stringify(create.json));
  assert.equal(create.json.payment.payAddress, addr);

  // First poll: detects the fake transfer, sets nativeFirstSeenAt. Still
  // pending — confirmWindowMs (5s) hasn't elapsed.
  const first = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(first.status, 200);
  assert.equal(first.json.payment.status, 'pending', 'not confirmed yet — confirm window has not elapsed');

  // Let PAYMENT_PENDING_TTL_MS (300ms) elapse while still well inside
  // NATIVE_TRON_CONFIRM_SECONDS (5s). Without the fix, the next poll falls
  // through to the TTL-expiry branch and wrongly expires an order with real
  // money already detected on its address.
  await new Promise(r => setTimeout(r, 500));

  const second = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(second.status, 200);
  assert.equal(second.json.payment.status, 'pending', 'a detected transfer must never be expired out from under it, however long PENDING_TTL_MS has elapsed');

  // The same protection must hold for an explicit cancel, not just the
  // passive TTL check — a buyer clicking "cancel" after having already paid
  // must be refused, not silently lose the money to a released address.
  const cancel = await api('POST', '/api/payments/cancel', { token: buyerTok, body: { orderId } });
  assert.notEqual(cancel.status, 200, 'must refuse to cancel an order with an already-detected payment');
  assert.equal(cancel.json.error, 'payment_detected');

  const pool = await api('GET', '/api/admin/crypto-addresses', { token: admin });
  const net = pool.json.networks.find(n => n.network === 'tron-usdt-trc20');
  assert.equal(net.assigned, 1, 'the address must stay assigned to this order, never released back to the pool');
});

test('once fully confirmed, the payment marks paid instead of being expired', async (t) => {
  const usdAmount = 10;
  const microUnits = Math.round(usdAmount * 1e6);
  const fakeTronGrid = await startFakeTronGrid(microUnits);
  t.after(() => fakeTronGrid.close());
  const fakePort = fakeTronGrid.address().port;

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_tron',
    NATIVE_TRON_API_BASE: `http://127.0.0.1:${fakePort}`,
    NATIVE_TRON_CONFIRM_SECONDS: '0',
    PAYMENT_PENDING_TTL_MS: '300',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const addr = 'TAbcRaceTest0000000000000000000002';
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'tron-usdt-trc20', addresses: addr } });

  const sellerTok = await verifiedSeller(api, admin, 'seller-race2@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: usdAmount });

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-race2@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-race2@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const orderId = 'ORD-RACE2-' + Date.now();
  await api('POST', '/api/payments/escrow', { token: buyerTok, body: { orderId, listingId: item.id, method: 'crypto' } });

  // NATIVE_TRON_CONFIRM_SECONDS=0: the very first poll that detects the
  // transfer should confirm it immediately.
  const res = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(res.status, 200);
  assert.equal(res.json.payment.status, 'paid', 'a real transfer with a zero confirm window marks paid on first detection');
});

test('a genuinely abandoned checkout (no transfer ever observed) still expires at its real deadline, not double', async (t) => {
  // syncProviderPayment's TTL check used to compare against
  // record.expiresAt (already createdAt + PENDING_TTL_MS) and then add a
  // SECOND PENDING_TTL_MS on top before actually expiring — silently
  // doubling the real payable window past what expiresAt (and the
  // buyer-facing countdown timer built from it) promises. Confirms the
  // fixed check expires at the documented single window, using a fake
  // TronGrid that reports nothing so this is purely the abandoned-checkout
  // path, not the sticky-nativeFirstSeenAt one covered above.
  const emptyTronGrid = await startEmptyFakeTronGrid();
  t.after(() => emptyTronGrid.close());
  const fakePort = emptyTronGrid.address().port;

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_tron',
    NATIVE_TRON_API_BASE: `http://127.0.0.1:${fakePort}`,
    PAYMENT_PENDING_TTL_MS: '300',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const addr = 'TAbcRaceTest0000000000000000000003';
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'tron-usdt-trc20', addresses: addr } });

  const sellerTok = await verifiedSeller(api, admin, 'seller-race3@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 10 });

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-race3@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-race3@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const orderId = 'ORD-RACE3-' + Date.now();
  await api('POST', '/api/payments/escrow', { token: buyerTok, body: { orderId, listingId: item.id, method: 'crypto' } });

  // Just past the single 300ms window — with the doubling bug this would
  // still read 'pending' (real threshold would have been 600ms).
  await new Promise(r => setTimeout(r, 400));

  const res = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(res.status, 200);
  assert.equal(res.json.payment.status, 'expired', 'expires at the single documented window, not double');

  const pool = await api('GET', '/api/admin/crypto-addresses', { token: admin });
  const net = pool.json.networks.find(n => n.network === 'tron-usdt-trc20');
  assert.equal(net.available, 1, 'a genuinely abandoned order releases its address back to the pool');
});
