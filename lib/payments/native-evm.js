/* Accept USDT-ERC20 (Ethereum) or USDT-BEP20 (BSC) directly on-chain — no
 * payment processor. Same architecture and same caveats as
 * lib/payments/native-tron.js (read that file's doc comment first): a
 * pre-generated address pool, no private keys ever touched here, and
 * UNTESTED AGAINST A REAL CHAIN — this development environment has no
 * outbound network access to any Ethereum/BSC RPC to verify this against.
 * Testnet-verify (Sepolia / BSC Testnet) before mainnet.
 *
 * Detecting an incoming ERC20 transfer without running a node means reading
 * the token contract's Transfer(address,address,uint256) event log via
 * eth_getLogs on a public JSON-RPC endpoint. That call needs a bounded block
 * range (most public RPCs reject/truncate unbounded queries), so
 * createInvoice captures the current block height as `fromBlock` — the
 * caller must persist it on the payment record and hand it back on every
 * check (see the `context` param below), the same way it already persists
 * providerPaymentId/payAddress.
 *
 * One factory, two instances (native_eth, native_bsc) — the contract
 * address, decimals, and RPC differ; the log-reading logic doesn't.
 */

const { coversExpected } = require('./amounts');

// keccak256("Transfer(address,address,uint256)") — standard, public, stable.
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// Both EVM providers here carry USD-pegged USDT, quoted to 2 places (the
// token's own 18 or 6 decimals are a separate thing — see decimals()).
const QUOTE_DECIMALS = 2;

function padAddressTopic(address) {
  const hex = String(address || '').toLowerCase().replace(/^0x/, '');
  return '0x' + hex.padStart(64, '0');
}

function isEvmAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ''));
}

/* A malformed token contract address makes every eth_getLogs call query
 * nonsense, so no payment ever confirms — and nothing about that is visible
 * except orders quietly never completing. The default shipped truncated to 39
 * hex digits once; this makes that class of typo (in the default or in a
 * *_USDT_CONTRACT override) an immediate, named error instead. */
function assertValidContract(value, network) {
  if (!isEvmAddress(value)) {
    throw new Error(
      `${network}: token contract address "${value}" is not a valid 20-byte address ` +
      '(expected 0x followed by 40 hex characters) — check the *_USDT_CONTRACT setting'
    );
  }
  return value;
}

function createEvmProvider({ network, providerName, envPrefix, defaultRpcUrl, defaultContract, defaultDecimals, defaultMinConfirmations }) {
  function rpcUrl() {
    return process.env[`${envPrefix}_RPC_URL`] || defaultRpcUrl;
  }
  function contract() {
    return process.env[`${envPrefix}_USDT_CONTRACT`] || defaultContract;
  }
  function decimals() {
    const n = Number(process.env[`${envPrefix}_USDT_DECIMALS`]);
    return Number.isFinite(n) && n >= 0 ? n : defaultDecimals;
  }
  /* This wall-clock wait is a small extra margin ON TOP of the real
   * confirmation-depth check checkAddressForPayment now does below — it is
   * NOT the primary defense against a reorg the way it is for TRON/Solana
   * (see those modules). Low by design; raise it if you want more buffer
   * between "enough blocks have passed" and "the buyer's page is told so". */
  function confirmWindowMs() {
    const secs = Number(process.env[`${envPrefix}_CONFIRM_SECONDS`]);
    return (Number.isFinite(secs) && secs >= 0 ? secs : 15) * 1000;
  }
  /* How many blocks must sit on top of a transfer's block before it's
   * trusted — an account-based chain's logs carry no "confirmed" flag the
   * way Bitcoin/Litecoin's esplora API does (see native-utxo.js), so this is
   * the only real defense against crediting a transfer a reorg later erases.
   * Defaults are conservative, not aggressive: ~12 blocks is the long-standing
   * Ethereum norm (well past the ~2-block depth any realistic mainnet reorg
   * has reached since the Merge); BSC's default is higher because it has a
   * documented history of much deeper reorgs (dozens of blocks) than Ethereum
   * ever has. */
  function minConfirmations() {
    const n = Number(process.env[`${envPrefix}_MIN_CONFIRMATIONS`]);
    return Number.isFinite(n) && n >= 0 ? n : defaultMinConfirmations;
  }

  async function rpcCall(method, params) {
    const r = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!r.ok) throw new Error(`${network} RPC HTTP ${r.status}`);
    const data = await r.json().catch(() => ({}));
    if (data.error) throw new Error(`${network} RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    return data.result;
  }

  let _cryptoAddressStore = null;
  function configure({ cryptoAddressStore }) {
    _cryptoAddressStore = cryptoAddressStore;
  }
  function configured() {
    return process.env.PAYMENT_PROVIDER === providerName && !!_cryptoAddressStore;
  }

  /* Claims a pooled address AND captures the current block height as the
   * scan's starting point — see module doc comment. `context.fromBlock` is
   * a decimal string; callers must persist it on the payment record and
   * pass it back into checkAddressForPayment.
   *
   * The block-height read is best-effort: a checkout must not fail just
   * because the RPC hiccupped for one call when the address pool itself had
   * plenty of capacity — that would turn a transient network blip into a
   * full checkout outage. Falling back to fromBlock: null makes the first
   * checkAddressForPayment scan from genesis instead (checkAddressForPayment
   * defaults it to '0x0') — slower and heavier on public RPC rate limits for
   * that one order, but correct, and self-healing (context is only read
   * once, right at order creation, so this never repeats per order). */
  async function createInvoice({ orderId, amount }) {
    if (!_cryptoAddressStore) throw new Error(`${network} payment provider not configured (no address pool store wired)`);
    const claim = await _cryptoAddressStore.claimForOrder(network, orderId);
    if (claim.empty) throw new Error('No deposit addresses available in the pool — add more via the admin panel');
    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    // The starting block is the watermark that scopes the log scan to THIS
    // invoice. Pooled addresses are recycled (lib/crypto-address-store.js
    // returns them to the pool on cancel/expiry), so a scan that starts
    // anywhere earlier can match the PREVIOUS order's transfer and report
    // this order paid for money that was never sent for it.
    //
    // This used to swallow an RPC failure and leave fromBlock null, which
    // made the first check scan a 200,000-block lookback — precisely the
    // window in which a recycled address's old payment lives. Failing the
    // checkout is the safe direction and self-heals: claimForOrder is
    // idempotent, so the buyer's retry gets the same address and reads the
    // height again.
    let fromBlock;
    try {
      const currentBlockHex = await rpcCall('eth_blockNumber', []);
      fromBlock = parseInt(currentBlockHex, 16);
    } catch (err) {
      throw new Error(`${network}: could not read the current block height to start this invoice's scan — ${err.message}`);
    }
    if (!Number.isFinite(fromBlock)) {
      throw new Error(`${network}: RPC returned an unusable block height for this invoice's scan start`);
    }
    return {
      provider: network,
      providerPaymentId: claim.doc.address,
      payUrl: null,
      payAddress: claim.doc.address,
      payAmount: amt,
      context: { fromBlock },
      raw: { network },
    };
  }

  function isPaidStatus(status) {
    return status === 'paid';
  }

  /**
   * Reads the token contract's Transfer log for transfers INTO `address`
   * since `context.fromBlock`. Returns { found, amount, txId, from } |
   * { found: false } — but unlike a first read of the log, `found` here
   * already means minConfirmations() blocks have been mined on top of it.
   * A matching transfer that hasn't reached that depth yet is treated the
   * same as "nothing observed" (not a separate "seen but not confirmed"
   * signal) — it will naturally start reporting found once a later poll
   * sees enough blocks stacked on it, since the same log is still there at
   * the same block number every time this re-scans the range. The caller
   * still applies confirmWindowMs() on top as a small extra margin, same
   * policy split as native-tron.js, but that margin is no longer this
   * chain's only defense against a reorg the way it is for TRON/Solana.
   */
  async function checkAddressForPayment(address, expectedAmount, context) {
    if (!address) return { found: false };
    // Needed either way now: to pick a lookback start when no fromBlock was
    // captured at invoice creation, AND to compute each candidate transfer's
    // confirmation depth below.
    if (context?.fromBlock == null) {
      // No watermark means there is no safe window to scan — see
      // createInvoice. Refusing keeps a recycled address's earlier payment
      // from being read as this order's.
      throw new Error(`${network}: payment record has no fromBlock watermark — cannot safely check for payment`);
    }
    // Validate configuration before spending an RPC round-trip on it: a
    // malformed contract address can only ever produce a useless query, and
    // surfacing that as itself (rather than as whatever the RPC says about
    // the nonsense it was handed) is the difference between a named error and
    // an order that silently never confirms.
    const tokenContract = assertValidContract(contract(), network);
    const latestHex = await rpcCall('eth_blockNumber', []);
    const latest = parseInt(latestHex, 16);
    const fromBlock = '0x' + Number(context.fromBlock).toString(16);
    const logs = await rpcCall('eth_getLogs', [{
      fromBlock,
      toBlock: 'latest',
      address: tokenContract,
      topics: [TRANSFER_TOPIC, null, padAddressTopic(address)],
    }]);
    if (!Array.isArray(logs) || !logs.length) return { found: false };

    const minConf = minConfirmations();
    const divisor = 10 ** decimals();
    // Sum every sufficiently-confirmed transfer in the window rather than
    // requiring one that covers the whole total on its own, so a buyer who
    // pays in two transactions is credited instead of stranded.
    let total = 0;
    let newest = null;
    for (const log of logs) {
      const logBlock = parseInt(log.blockNumber, 16);
      if (!Number.isFinite(logBlock)) continue;
      if (latest - logBlock < minConf) continue; // not deep enough yet — try again next poll
      // A Transfer's value is a uint256. For an 18-decimal token (BSC's USDT)
      // the raw integer routinely exceeds 2^53, where parseInt silently loses
      // precision — read it as a BigInt and scale down exactly.
      let units;
      try { units = BigInt(log.data); } catch (_) { continue; }
      const value = Number(units) / divisor;
      if (!Number.isFinite(value) || value <= 0) continue;
      total += value;
      if (!newest) newest = log;
    }
    if (total <= 0) return { found: false };
    if (!coversExpected(total, expectedAmount, QUOTE_DECIMALS)) return { found: false };
    const fromTopic = newest?.topics?.[1] || '';
    return { found: true, amount: total, txId: newest?.transactionHash || null, from: '0x' + fromTopic.slice(-40) };
  }

  return { configure, configured, createInvoice, checkAddressForPayment, isPaidStatus, confirmWindowMs, NETWORK: network };
}

const nativeEth = createEvmProvider({
  network: 'eth-usdt-erc20',
  providerName: 'native_eth',
  envPrefix: 'NATIVE_ETH',
  defaultRpcUrl: 'https://cloudflare-eth.com',
  // Tether (USDT) on Ethereum mainnet. This was previously written with the
  // trailing character missing — 39 hex digits instead of 40 — which is not a
  // valid 20-byte address at all, so every eth_getLogs call for this provider
  // queried a malformed contract and no ERC-20 payment could ever confirm.
  // assertValidContract() below now fails loudly on any such value rather
  // than letting it fail silently per-poll.
  defaultContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  defaultDecimals: 6,
  defaultMinConfirmations: 12,
});

const nativeBsc = createEvmProvider({
  network: 'bsc-usdt-bep20',
  providerName: 'native_bsc',
  envPrefix: 'NATIVE_BSC',
  defaultRpcUrl: 'https://bsc-dataseed.binance.org',
  defaultContract: '0x55d398326f99059fF775485246999027B3197955',
  defaultDecimals: 18,
  // Higher than Ethereum's default: BSC has a documented history of much
  // deeper reorgs than Ethereum has ever had post-Merge.
  defaultMinConfirmations: 20,
});

module.exports = { createEvmProvider, nativeEth, nativeBsc };
