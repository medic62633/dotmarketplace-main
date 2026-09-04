/* Accept USDT-TRC20 payments directly on-chain — no payment processor.
 *
 * UNTESTED AGAINST A REAL CHAIN. Written from TronGrid's documented REST API,
 * but this development environment has no outbound network access to
 * api.trongrid.io (or any blockchain RPC/explorer) to verify it against —
 * see README "Going to production" / native crypto payments section. Run
 * this against Shasta testnet (set NATIVE_TRON_API_BASE and
 * NATIVE_TRON_USDT_CONTRACT to testnet values) with real testnet USDT before
 * ever pointing it at mainnet.
 *
 * How it works: an admin pastes real TRON addresses (generated in their own
 * wallet — this module never generates or touches a private key) into the
 * address pool (lib/crypto-address-store.js). createInvoice claims one
 * address per order, atomically and idempotently, same as this codebase's
 * stock-credential pool. checkAddressForPayment polls TronGrid for confirmed
 * USDT-TRC20 transfers into that address; the caller (lib/payment-routes.js's
 * syncProviderPayment) is the one that decides an order is actually PAID —
 * this module only reports what it observed on-chain, deliberately, so the
 * confirmation-delay policy lives in one reviewable place, not buried here.
 */

const { coversExpected } = require('./amounts');

const NETWORK = 'tron-usdt-trc20';
// USDT-TRC20 quotes to 2 places; the token itself carries 6.
const TOKEN_DECIMALS = 2;
// Mainnet USDT-TRC20 contract — well-known, public, not sensitive. Override
// for testnet (Shasta/Nile don't have an "official" USDT; deploy or find a
// test token there and point this at it).
const DEFAULT_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function apiBase() {
  return (process.env.NATIVE_TRON_API_BASE || 'https://api.trongrid.io').replace(/\/$/, '');
}
function usdtContract() {
  return process.env.NATIVE_TRON_USDT_CONTRACT || DEFAULT_USDT_CONTRACT;
}
function apiHeaders() {
  const key = process.env.TRONGRID_API_KEY;
  return key ? { 'TRON-PRO-API-KEY': key } : {};
}

let _cryptoAddressStore = null;
/* Called once at boot (server.js, after stores exist) — mirrors how other
 * store-backed modules in this codebase get their collection/store handed
 * in after connectDb() resolves, rather than reaching for a global. */
function configure({ cryptoAddressStore }) {
  _cryptoAddressStore = cryptoAddressStore;
}

function configured() {
  return process.env.PAYMENT_PROVIDER === 'native_tron' && !!_cryptoAddressStore;
}

/* Claim a pooled address for this order. Idempotent — see
 * crypto-address-store.js's claimForOrder. Throws (loudly, not silently) if
 * the pool is empty so the checkout fails fast with an operator-actionable
 * error, rather than minting an order nobody can ever pay. */
async function createInvoice({ orderId, amount }) {
  if (!_cryptoAddressStore) throw new Error('native_tron payment provider not configured (no address pool store wired)');
  const claim = await _cryptoAddressStore.claimForOrder(NETWORK, orderId);
  if (claim.empty) throw new Error('No deposit addresses available in the pool — add more via the admin panel');
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  // Watermark: the newest transfer already sitting on this address at claim
  // time. Addresses are POOLED AND RECYCLED (lib/crypto-address-store.js
  // returns them to the pool when a checkout is cancelled or expires), so
  // without this a later order on the same address sees the PREVIOUS order's
  // transfer in the recent-transfer list and reports itself paid for money
  // that was never sent for it.
  //
  // Deliberately the chain's own newest block_timestamp rather than our
  // Date.now(): the comparison in checkAddressForPayment is then entirely in
  // chain time, so a server clock running ahead of (or behind) the chain
  // can't reject a real payment or admit an old one.
  const sinceTimestamp = await latestTransferTimestamp(claim.doc.address);
  return {
    provider: 'native_tron',
    providerPaymentId: claim.doc.address,
    payUrl: null,
    payAddress: claim.doc.address,
    payAmount: amt,
    context: { sinceTimestamp },
    raw: { network: NETWORK },
  };
}

function isPaidStatus(status) {
  return status === 'paid';
}

// How long a transfer must have been observed on-chain before it's trusted
// enough to release goods / credit a wallet — see the module doc comment for
// why this wall-clock delay stands in for TRON's block-confirmation count.
// Shared by both wallet top-ups and escrow checkout so the policy lives in
// exactly one place.
function confirmWindowMs() {
  const secs = Number(process.env.NATIVE_TRON_CONFIRM_SECONDS);
  return (Number.isFinite(secs) && secs >= 0 ? secs : 60) * 1000;
}

/* Recent USDT-TRC20 transfers INTO `address`, newest first. */
async function fetchIncomingTransfers(address) {
  const url = `${apiBase()}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`
    + `?contract_address=${encodeURIComponent(usdtContract())}&only_to=true&limit=20&order_by=block_timestamp,desc`;
  const r = await fetch(url, { headers: apiHeaders() });
  if (!r.ok) throw new Error(`TronGrid HTTP ${r.status}`);
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data.data) ? data.data : [];
}

/* Newest incoming-transfer timestamp currently on the address, as the
 * watermark for a new invoice. Throws rather than guessing: a silent 0 here
 * would make every pre-existing transfer on a recycled address count as
 * payment for the order about to be created. Same "fail loud, never silently
 * wrong" rule lib/payments/fx.js applies to a missing exchange rate — a
 * checkout that errors is recoverable, a free order is not. */
async function latestTransferTimestamp(address) {
  const txs = await fetchIncomingTransfers(address);
  let newest = 0;
  for (const tx of txs) {
    const ts = Number(tx.block_timestamp);
    if (Number.isFinite(ts) && ts > newest) newest = ts;
  }
  return newest;
}

/**
 * Query TronGrid for USDT-TRC20 transfers INTO `address` that arrived AFTER
 * this invoice's watermark, and report whether they add up to
 * `expectedAmount`. Does NOT itself decide the order is paid — see the module
 * doc comment. Returns { found, amount, txId, from } | { found: false }.
 *
 * Transfers at or before `context.sinceTimestamp` are ignored: they belong to
 * whatever this pooled address was doing before this order claimed it.
 *
 * Sums every qualifying transfer instead of looking for a single one that
 * covers the total, so a buyer who sends in two parts (common, and entirely
 * legitimate) is credited rather than left with money on an address that
 * never confirms.
 */
async function checkAddressForPayment(address, expectedAmount, context) {
  if (!address) return { found: false };
  const since = Number(context?.sinceTimestamp);
  if (!Number.isFinite(since)) {
    // No watermark on the record — refuse rather than fall back to scanning
    // everything, which is what made a recycled address replay an old
    // transfer as this order's payment.
    throw new Error('native_tron: payment record has no sinceTimestamp watermark — cannot safely check for payment');
  }
  const txs = await fetchIncomingTransfers(address);
  if (!txs.length) return { found: false };

  let total = 0;
  let newestTx = null;
  for (const tx of txs) {
    const ts = Number(tx.block_timestamp);
    if (!Number.isFinite(ts) || ts <= since) continue; // pre-dates this invoice
    // USDT-TRC20 uses 6 decimals; TronGrid's trc20 transfer `value` is the
    // raw integer token amount as a string, which can exceed 2^53 — parse it
    // as a BigInt so a large transfer isn't silently rounded.
    let units;
    try { units = BigInt(String(tx.value)); } catch (_) { continue; }
    const value = Number(units) / 1e6;
    if (!Number.isFinite(value) || value <= 0) continue;
    total += value;
    if (!newestTx) newestTx = tx;
  }
  if (total <= 0) return { found: false };
  if (!coversExpected(total, expectedAmount, TOKEN_DECIMALS)) return { found: false };
  return { found: true, amount: total, txId: newestTx?.transaction_id || null, from: newestTx?.from || null };
}

module.exports = {
  configure,
  configured,
  createInvoice,
  checkAddressForPayment,
  isPaidStatus,
  confirmWindowMs,
  NETWORK,
  usdtContract,
};
