/* Covers a real gap found while explaining native-evm.js's confirmation
 * policy: unlike Bitcoin/Litecoin's esplora API (which only ever reports
 * already-confirmed totals) or TRON/Solana's fast, well-understood finality,
 * an EVM `eth_getLogs` transfer log carries NO confirmation information at
 * all — a log entry appears the instant a block is mined, with nothing to
 * say whether that block might still be reorged out. The old
 * checkAddressForPayment reported `found: true` the moment a matching log
 * existed in ANY block up to `latest`, leaving a short wall-clock timer
 * (previously 90s — a small fraction of BSC's documented reorg depth in past
 * incidents) as the ONLY thing standing between "a transfer appeared in a
 * block" and "escrow held / wallet credited". A reorg landing inside that
 * window would let a payment get accepted and then vanish from the chain,
 * with no remaining code path that ever notices.
 *
 * checkAddressForPayment now requires the matching log to sit under at least
 * `*_MIN_CONFIRMATIONS` blocks before it reports `found` at all — the same
 * kind of real confirmation-depth guarantee the other three chain families
 * already had one way or another. This test drives a fake EVM JSON-RPC
 * server (this process's own child spawns the real server.js, which makes
 * the real fetch() call — nothing mocked in-process) through exactly that
 * scenario: a transfer that matches the expected amount but hasn't accrued
 * enough confirmations yet, then does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server');
const { adminToken, verifiedSeller, listing } = require('./helpers/fixtures');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/* A fake EVM JSON-RPC endpoint whose "latest block" and "the transfer's
 * block" are independently controllable via `state`, so a test can advance
 * one without the other — exactly what happens on a real chain between
 * polls (the transfer's own block never changes; only how many blocks sit
 * on top of it does). `state.logBlock === null` means "no transfer yet". */
function startFakeEvmRpc(state) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (_) {}
        const { method, id } = parsed;
        let result = null;
        if (method === 'eth_blockNumber') {
          result = '0x' + state.currentBlock.toString(16);
        } else if (method === 'eth_getLogs') {
          if (state.logBlock == null) {
            result = [];
          } else {
            result = [{
              data: '0x' + state.amountRaw.toString(16).padStart(64, '0'),
              topics: [TRANSFER_TOPIC, '0x' + 'a'.repeat(64), '0x' + 'b'.repeat(64)],
              blockNumber: '0x' + state.logBlock.toString(16),
              transactionHash: '0x' + 'c'.repeat(64),
            }];
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('a matching EVM transfer is not trusted until it has enough block confirmations, then is', async (t) => {
  const usdAmount = 10;
  const amountRaw = usdAmount * 1e6; // USDT-ERC20 default 6 decimals
  const state = { currentBlock: 1000, logBlock: null, amountRaw };
  const fakeRpc = await startFakeEvmRpc(state);
  t.after(() => fakeRpc.close());
  const fakePort = fakeRpc.address().port;

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_eth',
    NATIVE_ETH_RPC_URL: `http://127.0.0.1:${fakePort}`,
    NATIVE_ETH_MIN_CONFIRMATIONS: '3',
    // Isolated from the block-confirmation-depth check under test — a
    // near-zero wall-clock margin means the only thing gating "found" is
    // confirmation depth, not this timer.
    NATIVE_ETH_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const addr = '0x000000000000000000000000000000000000ab';
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'eth-usdt-erc20', addresses: addr } });

  const sellerTok = await verifiedSeller(api, admin, 'seller-evm-conf@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: usdAmount });

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-evm-conf@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-evm-conf@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const orderId = 'ORD-EVMCONF-' + Date.now();
  const create = await api('POST', '/api/payments/escrow', {
    token: buyerTok,
    body: { orderId, listingId: item.id, method: 'crypto' },
  });
  assert.equal(create.status, 200, JSON.stringify(create.json));
  assert.equal(create.json.payment.payAddress, addr);

  // The transfer lands in block 1002 — but "latest" is also 1002, so it has
  // exactly 0 confirmations. A matching amount alone must not be enough.
  state.currentBlock = 1002;
  state.logBlock = 1002;
  const zeroConf = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(zeroConf.status, 200);
  assert.equal(zeroConf.json.payment.status, 'pending', 'a transfer with 0 confirmations must not be trusted yet');

  // Still short of the configured minimum (3) — 2 blocks have been mined on
  // top of the transfer's own block.
  state.currentBlock = 1004;
  const underConf = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(underConf.status, 200);
  assert.equal(underConf.json.payment.status, 'pending', 'still short of the configured minimum confirmation depth');

  // Now at exactly 3 confirmations (1005 - 1002) — the configured minimum.
  state.currentBlock = 1005;
  const enoughConf = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
  assert.equal(enoughConf.status, 200);
  assert.equal(enoughConf.json.payment.status, 'paid', 'once the minimum confirmation depth is reached, the payment is trusted');
});

test('an EVM transfer matching the amount but never gaining confirmations never gets marked paid', async (t) => {
  // Companion to the test above: a transfer that appears and then the chain
  // simply never mines anything more on top of it (RPC lagging, or a poll
  // window shorter than the chain's own block time) must stay 'pending' —
  // never optimistically accepted just because SOME matching log exists.
  const usdAmount = 5;
  const amountRaw = usdAmount * 1e6;
  const state = { currentBlock: 2000, logBlock: 2000, amountRaw };
  const fakeRpc = await startFakeEvmRpc(state);
  t.after(() => fakeRpc.close());
  const fakePort = fakeRpc.address().port;

  const srv = await startServer({
    PAYMENT_PROVIDER: 'native_eth',
    NATIVE_ETH_RPC_URL: `http://127.0.0.1:${fakePort}`,
    NATIVE_ETH_MIN_CONFIRMATIONS: '12',
    NATIVE_ETH_CONFIRM_SECONDS: '0',
  });
  t.after(() => srv.stop());
  const { api } = srv;

  const admin = await adminToken(api);
  const addr = '0x000000000000000000000000000000000000cd';
  await api('POST', '/api/admin/crypto-addresses', { token: admin, body: { network: 'eth-usdt-erc20', addresses: addr } });

  const sellerTok = await verifiedSeller(api, admin, 'seller-evm-stall@example.com', 'Seller');
  const item = await listing(api, sellerTok, { price: usdAmount });

  await api('POST', '/api/auth/signup', { body: { email: 'buyer-evm-stall@example.com', password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'buyer-evm-stall@example.com', password: 'test12345' } });
  const buyerTok = signin.json.token;

  const orderId = 'ORD-EVMSTALL-' + Date.now();
  await api('POST', '/api/payments/escrow', { token: buyerTok, body: { orderId, listingId: item.id, method: 'crypto' } });

  for (let i = 0; i < 3; i++) {
    const res = await api('GET', '/api/payments/status/' + orderId, { token: buyerTok });
    assert.equal(res.json.payment.status, 'pending', 'no new blocks mined on top of the transfer — must not be trusted');
  }
});
