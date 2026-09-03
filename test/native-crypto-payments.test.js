/* Covers the address-pool mechanics for every native (no-processor) crypto
 * payment network this app supports (lib/payments/index.js's
 * NATIVE_PROVIDERS): claim-per-order, idempotency, pool exhaustion, and the
 * admin add/dedupe API. The pool logic is chain-agnostic (same
 * lib/crypto-address-store.js for all of them), so one parametrized test
 * covers every network instead of duplicating it seven times.
 *
 * Does NOT and cannot cover actual on-chain payment detection (each
 * provider's checkAddressForPayment) — that needs a real connection to
 * TronGrid / an EVM RPC / a Solana RPC / a Bitcoin-or-Litecoin explorer,
 * none of which this environment has network access to. See README "Going
 * to production" for the testnet verification every one of these chains
 * needs before real funds touch it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken } = require('./helpers/fixtures');

function fakeAddress(prefix, n) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = prefix;
  let x = n * 7919 + 1;
  for (let i = 0; i < 30; i++) { x = (x * 9301 + 49297) % 233280; s += alphabet[Math.floor((x / 233280) * alphabet.length)]; }
  return s;
}

const NETWORKS = [
  { provider: 'native_tron', network: 'tron-usdt-trc20', addrPrefix: 'T' },
  { provider: 'native_eth', network: 'eth-usdt-erc20', addrPrefix: '0x' },
  { provider: 'native_bsc', network: 'bsc-usdt-bep20', addrPrefix: '0x' },
  { provider: 'native_sol', network: 'sol-native', addrPrefix: '' },
  { provider: 'native_sol_usdt', network: 'sol-usdt-spl', addrPrefix: '' },
  { provider: 'native_btc', network: 'btc', addrPrefix: 'bc1q' },
  { provider: 'native_ltc', network: 'ltc', addrPrefix: 'ltc1q' },
];

for (const { provider, network, addrPrefix } of NETWORKS) {
  test(`${provider}: admin can pool addresses, wallet top-up claims one per order, and the pool exhausts loudly`, async (t) => {
    const srv = await startServer({ PAYMENT_PROVIDER: provider });
    t.after(() => srv.stop());
    const { api } = srv;

    const admin = await adminToken(api);

    const addr1 = fakeAddress(addrPrefix, 1);
    const addr2 = fakeAddress(addrPrefix, 2);
    const add = await api('POST', '/api/admin/crypto-addresses', {
      token: admin,
      body: { network, addresses: `${addr1}\n${addr2}\n${addr1}` }, // addr1 repeated on purpose
    });
    assert.equal(add.status, 200, JSON.stringify(add.json));
    assert.equal(add.json.added, 2, 'two distinct addresses added');
    assert.equal(add.json.duplicates, 1, 'the repeated address is reported, not silently dropped');
    assert.equal(add.json.stats.available, 2);

    const buyerEmail = `buyer-${provider}@example.com`;
    await api('POST', '/api/auth/signup', { body: { email: buyerEmail, password: 'test12345', name: 'Buyer' } });
    const signin = await api('POST', '/api/auth/signin', { body: { email: buyerEmail, password: 'test12345' } });
    const buyerTok = signin.json.token;

    const top1 = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount: 25 } });
    assert.equal(top1.status, 200, JSON.stringify(top1.json));
    assert.equal(top1.json.sandbox, false, 'a native on-chain deposit is never "sandbox" — it is always real');
    assert.ok([addr1, addr2].includes(top1.json.payAddress), 'claimed address comes from the pool');

    const top2 = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount: 25 } });
    assert.equal(top2.status, 200, JSON.stringify(top2.json));
    assert.notEqual(top2.json.payAddress, top1.json.payAddress, 'a second order claims a DIFFERENT pooled address');

    const statsAfter = await api('GET', '/api/admin/crypto-addresses', { token: admin });
    const pool = statsAfter.json.networks.find(n => n.network === network);
    assert.equal(pool.available, 0, 'pool is now exhausted');
    assert.equal(pool.assigned, 2);

    // A third order must fail loudly — never silently accept an order
    // nobody can ever pay because there's no address left to show them.
    const top3 = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount: 25 } });
    assert.notEqual(top3.status, 200, 'checkout fails, rather than minting an unpayable order, when the pool is empty');
  });
}

test('the admin crypto-address pool API is admin-only', async (t) => {
  const srv = await startServer({ PAYMENT_PROVIDER: 'native_tron' });
  t.after(() => srv.stop());
  const { api } = srv;

  const unauth = await api('GET', '/api/admin/crypto-addresses');
  assert.equal(unauth.status, 401);

  await api('POST', '/api/auth/signup', { body: { email: 'nobody@example.com', password: 'test12345', name: 'Nobody' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'nobody@example.com', password: 'test12345' } });
  const forbidden = await api('POST', '/api/admin/crypto-addresses', {
    token: signin.json.token,
    body: { network: 'tron-usdt-trc20', addresses: fakeAddress('T', 99) },
  });
  assert.equal(forbidden.status, 403);
});

test('adding addresses to an unsupported network is rejected', async (t) => {
  const srv = await startServer({ PAYMENT_PROVIDER: 'native_tron' });
  t.after(() => srv.stop());
  const { api } = srv;
  const admin = await adminToken(api);
  const res = await api('POST', '/api/admin/crypto-addresses', {
    token: admin,
    body: { network: 'dogecoin', addresses: fakeAddress('D', 1) },
  });
  assert.equal(res.status, 400);
});
