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

const NETWORK = 'tron-usdt-trc20';
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
  return {
    provider: 'native_tron',
    providerPaymentId: claim.doc.address,
    payUrl: null,
    payAddress: claim.doc.address,
    payAmount: amt,
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

/**
 * Query TronGrid for USDT-TRC20 transfers INTO `address`, and report whether
 * one matching (>=) `expectedAmount` has been observed. Does NOT itself
 * decide the order is paid — see the module doc comment. Returns
 * { found, amount, txId, from } | { found: false }.
 *
 * A 0.1% tolerance on the amount absorbs TRON's 6-decimal USDT rounding; it
 * is NOT a discount — never round in the buyer's favor beyond this.
 */
async function checkAddressForPayment(address, expectedAmount) {
  if (!address) return { found: false };
  const url = `${apiBase()}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`
    + `?contract_address=${encodeURIComponent(usdtContract())}&only_to=true&limit=20&order_by=block_timestamp,desc`;
  const r = await fetch(url, { headers: apiHeaders() });
  if (!r.ok) throw new Error(`TronGrid HTTP ${r.status}`);
  const data = await r.json().catch(() => ({}));
  const txs = Array.isArray(data.data) ? data.data : [];
  if (!txs.length) return { found: false };

  const minAmt = Number(expectedAmount) * 0.999;
  for (const tx of txs) {
    // USDT-TRC20 uses 6 decimals; TronGrid's trc20 transfer `value` is the
    // raw integer token amount as a string.
    const value = Number(tx.value) / 1e6;
    if (!Number.isFinite(value) || value < minAmt) continue;
    return { found: true, amount: value, txId: tx.transaction_id, from: tx.from };
  }
  return { found: false };
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
