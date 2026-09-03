/* Covers the address-pool mechanics for native (no-processor) crypto
 * payments: claim-per-order, idempotency, pool exhaustion, and the admin
 * add/dedupe API. Does NOT and cannot cover actual on-chain payment
 * detection (lib/payments/native-tron.js's checkAddressForPayment) — that
 * needs a real TronGrid connection this environment has no network access
 * to, and is untested; see README "Going to production" for the testnet
 * verification this needs before real funds touch it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken } = require('./helpers/fixtures');

function fakeTron(n) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = 'T';
  let x = n * 7919 + 1;
  for (let i = 0; i < 33; i++) { x = (x * 9301 + 49297) % 233280; s += alphabet[Math.floor((x / 233280) * alphabet.length)]; }
  return s;
}

test('native_tron: admin can pool addresses, wallet top-up claims one per order, and the pool exhausts loudly', async (t) => {
  const srv = await startServer({ PAYMENT_PROVIDER: 'native_tron', OXAPAY_MERCHANT_API_KEY: '', OXAPAY_API_KEY: '' });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);

  const addr1 = fakeTron(1);
  const addr2 = fakeTron(2);
  const add = await api('POST', '/api/admin/crypto-addresses', {
    token: admin,
    body: { network: 'tron-usdt-trc20', addresses: `${addr1}\n${addr2}\n${addr1}` }, // addr1 repeated on purpose
  });
  assert.equal(add.status, 200);
  assert.equal(add.json.added, 2, 'two distinct addresses added');
  assert.equal(add.json.duplicates, 1, 'the repeated address is reported, not silently dropped');
  assert.equal(add.json.stats.available, 2);

  await api('POST', '/api/auth/signup', { body: { email: 'buyer@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const top1 = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount: 25 } });
  assert.equal(top1.status, 200);
  assert.equal(top1.json.sandbox, false, 'a native on-chain deposit is never "sandbox" — it is always real');
  assert.ok([addr1, addr2].includes(top1.json.payAddress), 'claimed address comes from the pool');

  const top2 = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount: 25 } });
  assert.equal(top2.status, 200);
  assert.notEqual(top2.json.payAddress, top1.json.payAddress, 'a second order claims a DIFFERENT pooled address');

  const statsAfter = await api('GET', '/api/admin/crypto-addresses', { token: admin });
  const pool = statsAfter.json.networks.find(n => n.network === 'tron-usdt-trc20');
  assert.equal(pool.available, 0, 'pool is now exhausted');
  assert.equal(pool.assigned, 2);

  // A third order must fail loudly — never silently accept an order nobody
  // can ever pay because there's no address left to show them.
  const top3 = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount: 25 } });
  assert.notEqual(top3.status, 200, 'checkout fails, rather than minting an unpayable order, when the pool is empty');
});

test('native_tron: the admin pool API is admin-only', async (t) => {
  const srv = await startServer({ PAYMENT_PROVIDER: 'native_tron', OXAPAY_MERCHANT_API_KEY: '', OXAPAY_API_KEY: '' });
  t.after(() => srv.stop());
  const { api } = srv;

  const unauth = await api('GET', '/api/admin/crypto-addresses');
  assert.equal(unauth.status, 401);

  await api('POST', '/api/auth/signup', { body: { email: 'nobody@example.com', password: 'test12345', name: 'Nobody' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'nobody@example.com', password: 'test12345' } });
  const forbidden = await api('POST', '/api/admin/crypto-addresses', {
    token: signin.json.token,
    body: { network: 'tron-usdt-trc20', addresses: fakeTron(3) },
  });
  assert.equal(forbidden.status, 403);
});
