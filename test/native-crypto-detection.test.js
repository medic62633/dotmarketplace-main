/* On-chain payment DETECTION, which nothing covered before: every provider
 * decides whether real money arrived, and every one of them had a way to say
 * "yes" for money that never did.
 *
 * Deposit addresses are pooled and recycled — lib/crypto-address-store.js
 * returns an address to the pool whenever a checkout is cancelled or expires
 * unpaid — so an address routinely carries history from earlier orders. Each
 * provider therefore records a baseline/watermark at invoice creation and
 * must only count what arrived after it. These tests pin that boundary, plus
 * the amount comparison at its edges.
 *
 * Real HTTP against local chain stand-ins (test/helpers/fake-chains.js): the
 * server under test is a child process making genuine fetch() calls, so each
 * provider's own request and parsing code runs for real.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { adminToken } = require('./helpers/fixtures');
const { startFakeTron, startFakeEsplora, startFakeSolana, startFakeEvm, evmTransferLog } = require('./helpers/fake-chains');

const ADDR_TRON = 'TQ1n7yPy8hHqR4mVkKq1PjWnLpXk8sT7bZ';
const ADDR_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ADDR_SOL = 'So11111111111111111111111111111111111111112';

/** Pool one address for `network` and start a top-up, returning its orderId. */
async function poolAndTopup(api, admin, network, address, amount, buyerTok) {
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network, addresses: address } });
  const top = await api('POST', '/api/wallet/topup', { token: buyerTok, body: { amount } });
  return top;
}

async function makeBuyer(api, email) {
  await api('POST', '/api/auth/signup', { body: { email, password: 'test12345', name: 'Buyer' } });
  const s = await api('POST', '/api/auth/signin', { body: { email, password: 'test12345' } });
  return s.json.token;
}

const statusOf = async (api, token, orderId) =>
  (await api('GET', '/api/wallet/topup/' + orderId, { token })).json;

test('TRON: a transfer that pre-dates the invoice is never counted as its payment', async (t) => {
  // The pooled address already received exactly the amount this order will
  // ask for — an earlier order's payment, still visible in the recent
  // transfer list. Before the watermark existed, the very first poll matched
  // it and credited this order for money nobody sent.
  const chain = await startFakeTron({
    transfers: [{
      value: String(25 * 1e6),
      block_timestamp: Date.now() - 60_000,
      transaction_id: 'old-order-tx',
      from: 'TSomeoneElse000000000000000000000',
    }],
  });
  t.after(() => chain.close());

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_tron',
    NATIVE_TRON_API_BASE: chain.baseUrl,
    NATIVE_TRON_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const buyer = await makeBuyer(api, 'tron-replay@example.com');
  const top = await poolAndTopup(api, admin, 'tron-usdt-trc20', ADDR_TRON, 25, buyer);
  assert.equal(top.status, 200, JSON.stringify(top.json));

  const status = await statusOf(api, buyer, top.json.orderId);
  assert.notEqual(status.status, 'paid', 'the previous order\'s transfer must not pay this one');

  const wallet = await api('GET', '/api/wallet', { token: buyer });
  assert.equal(wallet.json.wallet.balance, 0, 'and no balance is credited');
});

test('TRON: a transfer after the invoice pays it, including split across two transactions', async (t) => {
  const chain = await startFakeTron();
  t.after(() => chain.close());

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_tron',
    NATIVE_TRON_API_BASE: chain.baseUrl,
    NATIVE_TRON_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const buyer = await makeBuyer(api, 'tron-split@example.com');
  const top = await poolAndTopup(api, admin, 'tron-usdt-trc20', ADDR_TRON, 40, buyer);
  assert.equal(top.status, 200, JSON.stringify(top.json));

  // The buyer sends it in two parts — neither covers the total alone.
  const now = Date.now();
  chain.state.transfers = [
    { value: String(15 * 1e6), block_timestamp: now + 1000, transaction_id: 'part-1', from: 'TBuyer0000000000000000000000000000' },
    { value: String(25 * 1e6), block_timestamp: now + 2000, transaction_id: 'part-2', from: 'TBuyer0000000000000000000000000000' },
  ];

  const status = await statusOf(api, buyer, top.json.orderId);
  assert.equal(status.status, 'paid', 'two partial transfers totalling the amount are credited');

  const wallet = await api('GET', '/api/wallet', { token: buyer });
  assert.equal(wallet.json.wallet.balance, 40);
});

test('TRON: an underpayment is not accepted as full payment', async (t) => {
  const chain = await startFakeTron();
  t.after(() => chain.close());

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_tron',
    NATIVE_TRON_API_BASE: chain.baseUrl,
    NATIVE_TRON_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const buyer = await makeBuyer(api, 'tron-short@example.com');
  const top = await poolAndTopup(api, admin, 'tron-usdt-trc20', ADDR_TRON, 1000, buyer);
  assert.equal(top.status, 200, JSON.stringify(top.json));

  // 999 USDT against a 1000 USDT invoice: 0.1% short. The old proportional
  // tolerance (expected * 0.999) accepted exactly this, handing over 1000
  // USDT of credit for 999 — a discount that grew with the order size.
  chain.state.transfers = [{
    value: String(999 * 1e6),
    block_timestamp: Date.now() + 1000,
    transaction_id: 'short-tx',
    from: 'TBuyer0000000000000000000000000000',
  }];

  const status = await statusOf(api, buyer, top.json.orderId);
  assert.notEqual(status.status, 'paid', '999 does not settle a 1000 invoice');
  const wallet = await api('GET', '/api/wallet', { token: buyer });
  assert.equal(wallet.json.wallet.balance, 0);
});

test('Bitcoin: an address\'s earlier lifetime funding is not counted as this order\'s payment', async (t) => {
  // funded_txo_sum only ever grows, so a recycled address carries every
  // payment it has ever taken. With the baseline defaulted to 0 (what a
  // failed read used to produce) that entire history read as this order's
  // payment on the first poll.
  const chain = await startFakeEsplora({ fundedSum: 500_000 }); // 0.005 BTC already received
  t.after(() => chain.close());

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_btc',
    NATIVE_BTC_API_BASE: chain.baseUrl,
    NATIVE_BTC_USD_RATE: '65000',
    NATIVE_BTC_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const buyer = await makeBuyer(api, 'btc-baseline@example.com');
  const top = await poolAndTopup(api, admin, 'btc', ADDR_BTC, 130, buyer); // 0.002 BTC
  assert.equal(top.status, 200, JSON.stringify(top.json));
  assert.equal(top.json.payAmount, 0.002);

  let status = await statusOf(api, buyer, top.json.orderId);
  assert.notEqual(status.status, 'paid', 'pre-existing funding is not this order\'s payment');

  // Now the buyer actually sends 0.002 BTC on top of that history.
  chain.state.fundedSum = 500_000 + 200_000;
  status = await statusOf(api, buyer, top.json.orderId);
  assert.equal(status.status, 'paid', 'the new deposit above the baseline does pay it');
  const wallet = await api('GET', '/api/wallet', { token: buyer });
  assert.equal(wallet.json.wallet.balance, 130);
});

test('Bitcoin: a failed baseline read refuses the checkout instead of assuming zero', async (t) => {
  // The dangerous path, and the reason the baseline read is no longer
  // optional. The explorer is briefly down exactly when the invoice is
  // created; the address is a recycled one that has already received far
  // more than this order asks for. Falling back to a baseline of 0 (what the
  // old .catch(() => 0) did) made that entire history read as this order's
  // payment, so the very first poll credited the buyer's wallet in full for
  // money nobody sent.
  const chain = await startFakeEsplora({ fundedSum: 5_000_000, failNextReads: 1 });
  t.after(() => chain.close());

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_btc',
    NATIVE_BTC_API_BASE: chain.baseUrl,
    NATIVE_BTC_USD_RATE: '65000',
    NATIVE_BTC_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const buyer = await makeBuyer(api, 'btc-blind@example.com');
  const top = await poolAndTopup(api, admin, 'btc', ADDR_BTC, 130, buyer);

  assert.notEqual(top.status, 200, 'no invoice is issued while the baseline is unknown');
  const wallet = await api('GET', '/api/wallet', { token: buyer });
  assert.equal(wallet.json.wallet.balance, 0, 'and nothing is credited off the address\'s history');
});

test('Solana: an address\'s pre-existing balance is not counted as this order\'s payment', async (t) => {
  const chain = await startFakeSolana({ tokenAmount: 500 }); // already holds 500 USDT-SPL
  t.after(() => chain.close());

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_sol_usdt',
    NATIVE_SOL_RPC_URL: chain.baseUrl,
    NATIVE_SOL_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const buyer = await makeBuyer(api, 'sol-baseline@example.com');
  const top = await poolAndTopup(api, admin, 'sol-usdt-spl', ADDR_SOL, 60, buyer);
  assert.equal(top.status, 200, JSON.stringify(top.json));

  let status = await statusOf(api, buyer, top.json.orderId);
  assert.notEqual(status.status, 'paid', 'the balance that was already there is not payment');

  chain.state.tokenAmount = 560; // buyer sends 60
  status = await statusOf(api, buyer, top.json.orderId);
  assert.equal(status.status, 'paid');
  const wallet = await api('GET', '/api/wallet', { token: buyer });
  assert.equal(wallet.json.wallet.balance, 60);
});

test('a malformed token contract address fails loudly instead of never matching', async (t) => {
  // The shipped Ethereum USDT default was truncated to 39 hex characters —
  // not a valid 20-byte address — so every eth_getLogs call queried nonsense
  // and no ERC-20 payment could ever confirm, with nothing to show for it but
  // orders that quietly never completed.
  const { nativeEth } = require('../lib/payments/native-evm');
  process.env.NATIVE_ETH_USDT_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec'; // 39 chars
  t.after(() => { delete process.env.NATIVE_ETH_USDT_CONTRACT; });

  await assert.rejects(
    () => nativeEth.checkAddressForPayment('0x' + '11'.repeat(20), 25, { fromBlock: 1 }),
    /not a valid 20-byte address/,
    'a bad contract address is named as the problem',
  );
});

test('the shipped Ethereum USDT default passes that validation and detects a payment', async (t) => {
  // Guards the specific regression: the default must be a real 20-byte
  // address, exercised through the same path a live poll takes rather than
  // by re-asserting the literal.
  delete process.env.NATIVE_ETH_USDT_CONTRACT;
  const chain = await startFakeEvm({ blockNumber: 1_000_100 });
  t.after(() => chain.close());
  process.env.NATIVE_ETH_RPC_URL = chain.baseUrl;
  t.after(() => { delete process.env.NATIVE_ETH_RPC_URL; });

  const { nativeEth } = require('../lib/payments/native-evm');
  const buyerAddr = '0x' + '11'.repeat(20);

  // Nothing on-chain yet for this invoice's window.
  let seen = await nativeEth.checkAddressForPayment(buyerAddr, 25, { fromBlock: 1_000_000 });
  assert.equal(seen.found, false);

  // A 25-USDT transfer, buried deep enough to clear the 12-block default.
  chain.state.logs = [evmTransferLog({ amount: 25, decimals: 6, blockNumber: 1_000_050 })];
  seen = await nativeEth.checkAddressForPayment(buyerAddr, 25, { fromBlock: 1_000_000 });
  assert.equal(seen.found, true, 'a confirmed transfer of the full amount is detected');
  assert.equal(seen.amount, 25);
});

test('EVM: a transfer that is not yet deep enough is not treated as payment', async (t) => {
  const chain = await startFakeEvm({ blockNumber: 1_000_100 });
  t.after(() => chain.close());
  process.env.NATIVE_ETH_RPC_URL = chain.baseUrl;
  t.after(() => { delete process.env.NATIVE_ETH_RPC_URL; });

  const { nativeEth } = require('../lib/payments/native-evm');
  // 5 blocks deep, against the 12-block default.
  chain.state.logs = [evmTransferLog({ amount: 25, decimals: 6, blockNumber: 1_000_095 })];
  const seen = await nativeEth.checkAddressForPayment('0x' + '11'.repeat(20), 25, { fromBlock: 1_000_000 });
  assert.equal(seen.found, false, 'still reorg-able, so not payment yet');
});

test('EVM: an 18-decimal transfer is read at full integer precision', async (t) => {
  // BSC's USDT carries 18 decimals, so a Transfer's raw uint256 routinely
  // exceeds 2^53, where parseInt loses integer precision. At realistic
  // amounts the resulting error lands far below a cent, so this guards the
  // parsing rather than pinning a bug that was ever observable in a balance
  // — it is here so a future change back to parseInt is caught.
  const chain = await startFakeEvm({ blockNumber: 2_000_100 });
  t.after(() => chain.close());
  process.env.NATIVE_BSC_RPC_URL = chain.baseUrl;
  t.after(() => { delete process.env.NATIVE_BSC_RPC_URL; });

  const { nativeBsc } = require('../lib/payments/native-evm');
  chain.state.logs = [evmTransferLog({ amount: 1234.56, decimals: 18, blockNumber: 2_000_050 })];
  const seen = await nativeBsc.checkAddressForPayment('0x' + '11'.repeat(20), 1234.56, { fromBlock: 2_000_000 });
  assert.equal(seen.found, true);
  assert.ok(Math.abs(seen.amount - 1234.56) < 1e-6, `got ${seen.amount}`);
});

test('a payment record with no baseline is refused rather than scanned from zero', async (t) => {
  // Every provider treats a missing watermark as unsafe: without it there is
  // no way to tell this order's payment from the pooled address's history.
  const chain = await startFakeEvm();
  t.after(() => chain.close());
  process.env.NATIVE_ETH_RPC_URL = chain.baseUrl;
  t.after(() => { delete process.env.NATIVE_ETH_RPC_URL; });

  const { nativeEth } = require('../lib/payments/native-evm');
  await assert.rejects(
    () => nativeEth.checkAddressForPayment('0x' + '11'.repeat(20), 25, {}),
    /no fromBlock watermark/,
  );
});

test('a record predating watermarks falls back to its own creation time on TRON only', async () => {
  // Invoices already pending when this shipped carry no nativeContext. TRON
  // compares timestamps, so the invoice's own createdAt is a sound lower
  // bound and those orders keep confirming. The balance-baseline chains
  // cannot reconstruct "the balance as it was at claim time" after the fact,
  // so they stay refused rather than guessing — the safe direction.
  const payments = require('../lib/payments');
  const createdAt = new Date('2026-01-01T00:00:00Z');

  const tron = payments.nativeContextFor({ provider: 'native_tron', createdAt });
  assert.equal(tron.sinceTimestamp, createdAt.getTime(), 'TRON recovers a usable watermark');

  for (const provider of ['native_btc', 'native_sol', 'native_eth']) {
    assert.equal(
      payments.nativeContextFor({ provider, createdAt }), null,
      `${provider} cannot reconstruct a baseline and must not invent one`,
    );
  }

  // An explicit context always wins over any fallback.
  const explicit = { sinceTimestamp: 123 };
  assert.equal(
    payments.nativeContextFor({ provider: 'native_tron', createdAt, nativeContext: explicit }),
    explicit,
  );
});
