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
const { adminToken, verifiedSeller, listing } = require('./helpers/fixtures');

function fakeAddress(prefix, n) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = prefix;
  let x = n * 7919 + 1;
  for (let i = 0; i < 30; i++) { x = (x * 9301 + 49297) % 233280; s += alphabet[Math.floor((x / 233280) * alphabet.length)]; }
  return s;
}

// BTC/LTC/native SOL are not USD-pegged, so lib/payments/fx.js converts the
// USDT top-up amount to a coin amount via a live CoinGecko lookup — no
// outbound access to that from this environment, so these three pin a fixed
// rate via NATIVE_{BTC,LTC,SOL}_USD_RATE (see fx.js) instead, and assert the
// conversion math itself. Every USDT-denominated network (decimals: 2, no
// usdRate below) skips conversion entirely — 1 USDT already = 1 to send.
const NETWORKS = [
  { provider: 'native_tron', network: 'tron-usdt-trc20', addrPrefix: 'T', decimals: 2 },
  { provider: 'native_eth', network: 'eth-usdt-erc20', addrPrefix: '0x', decimals: 2 },
  { provider: 'native_bsc', network: 'bsc-usdt-bep20', addrPrefix: '0x', decimals: 2 },
  { provider: 'native_sol', network: 'sol-native', addrPrefix: '', decimals: 6, usdRate: 150 },
  { provider: 'native_sol_usdt', network: 'sol-usdt-spl', addrPrefix: '', decimals: 2 },
  { provider: 'native_btc', network: 'btc', addrPrefix: 'bc1q', decimals: 8, usdRate: 65000 },
  { provider: 'native_ltc', network: 'ltc', addrPrefix: 'ltc1q', decimals: 8, usdRate: 80 },
];

for (const { provider, network, addrPrefix, decimals, usdRate } of NETWORKS) {
  test(`${provider}: admin can pool addresses, wallet top-up claims one per order, and the pool exhausts loudly`, async (t) => {
    const symbol = provider.replace('native_', '').toUpperCase();
    const envOverride = usdRate ? { [`NATIVE_${symbol}_USD_RATE`]: String(usdRate) } : {};
    const srv = await startServer({ PAYMENT_PROVIDER: provider, ...envOverride });
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
    assert.equal(top1.json.payDecimals, decimals);
    if (usdRate) {
      // Not USD-pegged (BTC/LTC/native SOL): payAmount must be the $25
      // converted at the pinned rate, not the raw dollar figure — asking a
      // buyer to send "25" units of a coin worth $65,000 each was the bug
      // this conversion exists to fix.
      const expected = Math.round((25 / usdRate) * 10 ** decimals) / 10 ** decimals;
      assert.equal(top1.json.payAmount, expected, 'USDT amount converted to the coin at the configured rate');
      assert.equal(top1.json.payAmountUsd, 25, 'original USD figure preserved for display');
      assert.notEqual(top1.json.payAmount, 25, 'never sends the raw USD figure as if it were coin units');
    } else {
      assert.equal(top1.json.payAmount, 25, 'USDT-denominated chain: 1 USDT = 1 to send, no conversion');
    }

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

test('escrow checkout on a non-USD-pegged native chain also converts the listing price (not just wallet top-up)', async (t) => {
  const srv = await startServer({ PAYMENT_PROVIDER: 'native_btc', NATIVE_BTC_USD_RATE: '65000' });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const addr = fakeAddress('bc1q', 1);
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'btc', addresses: addr } });

  const sellerTok = await verifiedSeller(api, admin, 'seller-btc@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: 130 }); // $130 at $65,000/BTC = 0.002 BTC

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-btc@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-btc@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const orderId = 'ORD-' + Date.now();
  const res = await api('POST', '/api/payments/escrow', {
    token: buyerTok,
    body: { orderId, listingId: item.id, method: 'crypto' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.payment.payAddress, addr);
  assert.equal(res.json.payment.payAmount, 0.002, '$130 at $65,000/BTC converts to 0.002 BTC, not "130" BTC');
  assert.equal(res.json.payment.payAmountUsd, 130);
});

test('checkout on a non-USD-pegged native chain fails loudly (never falls back to a 1:1 amount) when no exchange rate is available', async (t) => {
  // No NATIVE_BTC_USD_RATE override, and NATIVE_FX_API_BASE points at a
  // guaranteed-unreachable address (nothing listens on 127.0.0.1:1) so the
  // live CoinGecko fetch fails deterministically everywhere — this sandbox
  // has no outbound network access at all, but a real CI runner typically
  // does, so "no network access" can't be what this test relies on to force
  // the failure path it's asserting against: fail the checkout, don't
  // silently quote 20 BTC for a $20 top-up.
  const srv = await startServer({ PAYMENT_PROVIDER: 'native_btc', NATIVE_FX_API_BASE: 'http://127.0.0.1:1' });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'btc', addresses: fakeAddress('bc1q', 2) } });

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-btc2@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-btc2@example.com', password: 'test12345' } });

  const res = await api('POST', '/api/wallet/topup', { token: signin.json.token, body: { amount: 20 } });
  assert.notEqual(res.status, 200, 'checkout must fail rather than silently mint an invoice with the wrong amount');
  assert.doesNotMatch(JSON.stringify(res.json), /"payAmount":\s*20\b/, 'never returns the raw USD figure as a BTC amount');
});
