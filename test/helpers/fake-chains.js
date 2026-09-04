/* Local stand-ins for the chain APIs each native payment provider talks to.
 *
 * Every provider reads real chain state twice: once at invoice creation, to
 * record the baseline/watermark that scopes detection to THIS order, and
 * again on each poll to see what has arrived since. Both reads are mandatory
 * now (a missing baseline is refused rather than defaulted to zero — see each
 * provider), so tests need a chain to talk to, not just an unreachable URL.
 *
 * These are real HTTP servers: the server under test is a separate child
 * process making genuine fetch() calls, so nothing here is mocked in-process
 * and the provider's own request/parse code is exercised end to end. Each
 * handle exposes mutable state so a test can move the chain forward between
 * polls — "nothing sent yet", then "payment arrived" — the way time actually
 * passes for a buyer.
 */
const http = require('node:http');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/* TronGrid: GET /v1/accounts/{addr}/transactions/trc20 → { data: [transfer] }.
 * `state.transfers` entries are { value (raw 6-decimal string), block_timestamp
 * (ms), transaction_id, from }. */
async function startFakeTron(initial = {}) {
  const state = { transfers: [], ...initial };
  const h = await listen((req, res) => sendJson(res, { data: state.transfers }));
  return { ...h, state };
}

/* EVM JSON-RPC: eth_blockNumber and eth_getLogs. `state.blockNumber` is a
 * decimal number; `state.logs` are Transfer log objects. */
async function startFakeEvm(initial = {}) {
  const state = { blockNumber: 1_000_000, logs: [], ...initial };
  const h = await listen((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let call = {};
      try { call = JSON.parse(raw); } catch (_) {}
      if (call.method === 'eth_blockNumber') {
        return sendJson(res, { jsonrpc: '2.0', id: call.id, result: '0x' + state.blockNumber.toString(16) });
      }
      if (call.method === 'eth_getLogs') {
        // A real node rejects a malformed contract address rather than
        // quietly returning nothing — without this the stub would happily
        // answer queries no live RPC would accept, and a bad contract would
        // look fine in tests while never confirming in production.
        const addr = call.params?.[0]?.address;
        if (addr != null && !/^0x[0-9a-fA-F]{40}$/.test(String(addr))) {
          return sendJson(res, {
            jsonrpc: '2.0',
            id: call.id,
            error: { code: -32602, message: 'invalid argument 0: hex string has length 39, want 40 for common.Address' },
          });
        }
        const fromBlock = parseInt(call.params?.[0]?.fromBlock ?? '0x0', 16);
        const logs = state.logs.filter(l => parseInt(l.blockNumber, 16) >= fromBlock);
        return sendJson(res, { jsonrpc: '2.0', id: call.id, result: logs });
      }
      return sendJson(res, { jsonrpc: '2.0', id: call.id, result: null });
    });
  });
  return { ...h, state };
}

/** Build an ERC-20 Transfer log for `amount` whole tokens at `decimals`. */
function evmTransferLog({ amount, decimals, blockNumber, txHash = '0xdeadbeef', from = '0x' + '11'.repeat(20) }) {
  const units = BigInt(Math.round(amount * 10 ** decimals));
  return {
    data: '0x' + units.toString(16).padStart(64, '0'),
    blockNumber: '0x' + Number(blockNumber).toString(16),
    transactionHash: txHash,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x' + from.replace(/^0x/, '').padStart(64, '0'),
      '0x' + '22'.repeat(32),
    ],
  };
}

/* Solana JSON-RPC: getBalance (lamports), getTokenAccountsByOwner (SPL), and
 * getSignaturesForAddress. `state.lamports` / `state.tokenAmount` are what the
 * pooled address currently holds. */
async function startFakeSolana(initial = {}) {
  const state = { lamports: 0, tokenAmount: 0, ...initial };
  const h = await listen((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let call = {};
      try { call = JSON.parse(raw); } catch (_) {}
      if (call.method === 'getBalance') {
        return sendJson(res, { jsonrpc: '2.0', id: call.id, result: { value: state.lamports } });
      }
      if (call.method === 'getTokenAccountsByOwner') {
        return sendJson(res, {
          jsonrpc: '2.0',
          id: call.id,
          result: {
            value: state.tokenAmount
              ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: state.tokenAmount } } } } } }]
              : [],
          },
        });
      }
      if (call.method === 'getSignaturesForAddress') {
        return sendJson(res, { jsonrpc: '2.0', id: call.id, result: [{ signature: 'fake-sol-sig' }] });
      }
      return sendJson(res, { jsonrpc: '2.0', id: call.id, result: null });
    });
  });
  return { ...h, state };
}

/* Esplora (Bitcoin/Litecoin): GET /address/{addr} → chain_stats.funded_txo_sum,
 * the total satoshis the address has ever received.
 *
 * `state.failNextReads` makes that many reads fail with a 503 first — the
 * transient-explorer-outage case, which is exactly when a provider is
 * tempted to invent a baseline. */
async function startFakeEsplora(initial = {}) {
  const state = { fundedSum: 0, failNextReads: 0, ...initial };
  const h = await listen((req, res) => {
    if (state.failNextReads > 0) {
      state.failNextReads--;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'explorer unavailable' }));
    }
    sendJson(res, {
      chain_stats: { funded_txo_sum: state.fundedSum },
      mempool_stats: { funded_txo_sum: 0 },
    });
  });
  return { ...h, state };
}

module.exports = {
  startFakeTron,
  startFakeEvm,
  startFakeSolana,
  startFakeEsplora,
  evmTransferLog,
};
