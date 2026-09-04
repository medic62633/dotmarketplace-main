const nativeTron = require('./native-tron');
const { nativeEth, nativeBsc } = require('./native-evm');
const { nativeSol, nativeSolUsdt } = require('./native-solana');
const { nativeBtc, nativeLtc } = require('./native-utxo');

/* Every "no processor" native chain provider, keyed by the PAYMENT_PROVIDER
 * value that selects it. Each shares the same shape (configure, configured,
 * createInvoice, checkAddressForPayment, isPaidStatus, confirmWindowMs,
 * NETWORK) — see lib/payments/native-tron.js's doc comment for the whole
 * design (address pool, no private keys here, untested-against-a-real-chain
 * caveat that applies to every one of these). Adding a new native chain
 * means adding one entry here — lib/payment-routes.js and
 * lib/wallet-routes.js dispatch through this registry generically, not by
 * name, so nothing else needs to change.
 *
 * There is no external payment processor anymore — every crypto payment is
 * accepted directly into the operator's own wallets via this registry. If
 * PAYMENT_PROVIDER doesn't match any entry here, crypto checkout is simply
 * unconfigured (wallet-only mode). */
const NATIVE_PROVIDERS = {
  native_tron: nativeTron,
  native_eth: nativeEth,
  native_bsc: nativeBsc,
  native_sol: nativeSol,
  native_sol_usdt: nativeSolUsdt,
  native_btc: nativeBtc,
  native_ltc: nativeLtc,
};

function provider() {
  return (process.env.PAYMENT_PROVIDER || '').toLowerCase();
}

/* Called once at boot (server.js), after the crypto address pool store
 * exists. Every native provider gets the same store reference — harmless
 * for the ones not actually selected by PAYMENT_PROVIDER, since each one's
 * own `configured()` still gates on its own provider name. */
function configureNativeProviders({ cryptoAddressStore }) {
  for (const p of Object.values(NATIVE_PROVIDERS)) p.configure({ cryptoAddressStore });
}

function isConfigured() {
  const native = NATIVE_PROVIDERS[provider()];
  return !!native && native.configured();
}

function publicUrl() {
  return (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

async function createEscrowInvoice({ orderId, amount }) {
  const key = provider();
  const native = NATIVE_PROVIDERS[key];
  if (native) {
    const invoice = await native.createInvoice({ orderId, amount });
    // Some native modules (native-evm/-solana/-utxo) return their chain's
    // NETWORK constant (e.g. 'eth-usdt-erc20') as `provider` for their own
    // internal bookkeeping, not the PAYMENT_PROVIDER key ('native_eth').
    // Callers persist this value as the payment record's `provider` and
    // later look it up in NATIVE_PROVIDERS by that same key (see
    // lib/payment-routes.js's syncProviderPayment) — a mismatch here means
    // the record is orphaned from its own provider module and its on-chain
    // status is never polled again. Normalize to the PAYMENT_PROVIDER key
    // here, once, rather than trusting every module's return shape.
    return { ...invoice, provider: key };
  }
  throw new Error('No crypto payment provider configured');
}

// Friendly display info for each native provider, keyed the same way as
// NATIVE_PROVIDERS — shown immediately at invoice creation (not just after
// payment confirms), so the pending-payment UI can name the exact network
// and currency the buyer must send. `decimals` is how many places the
// gateway UI (and native-utxo.js/native-solana.js's own conversion) shows
// and rounds that currency's amount to — 2 for a USD-pegged stablecoin,
// 8 for BTC/LTC (satoshi precision), 6 for native SOL (ample precision
// below its 9-decimal lamport unit without implying false exactness).
const NATIVE_NETWORK_LABELS = {
  native_tron: { payNetwork: 'TRON', payCurrency: 'USDT', networkLabel: 'TRON (TRC-20)', decimals: 2 },
  native_eth: { payNetwork: 'Ethereum', payCurrency: 'USDT', networkLabel: 'Ethereum (ERC-20)', decimals: 2 },
  native_bsc: { payNetwork: 'BSC', payCurrency: 'USDT', networkLabel: 'BNB Smart Chain (BEP-20)', decimals: 2 },
  native_sol: { payNetwork: 'Solana', payCurrency: 'SOL', networkLabel: 'Solana', decimals: 6 },
  native_sol_usdt: { payNetwork: 'Solana', payCurrency: 'USDT', networkLabel: 'Solana (USDT-SPL)', decimals: 2 },
  native_btc: { payNetwork: 'Bitcoin', payCurrency: 'BTC', networkLabel: 'Bitcoin', decimals: 8 },
  native_ltc: { payNetwork: 'Litecoin', payCurrency: 'LTC', networkLabel: 'Litecoin', decimals: 8 },
};

/* How far along an on-chain payment is, for a record whose provider is a
 * native chain: null once nothing has been observed yet (still just
 * "waiting"), otherwise how many seconds remain in that provider's
 * confirmWindowMs() before the transfer it already saw is trusted enough to
 * mark the order paid. Lets the UI show real progress ("detected, confirming
 * — 12s left") instead of a static spinner for the entire wait. */
function paymentProgress(record) {
  if (!record || record.status === 'paid' || !record.nativeFirstSeenAt) return null;
  const native = NATIVE_PROVIDERS[record.provider];
  if (!native) return null;
  const totalMs = native.confirmWindowMs();
  const waitedMs = Date.now() - new Date(record.nativeFirstSeenAt).getTime();
  return {
    seenAt: record.nativeFirstSeenAt,
    confirmSecondsTotal: Math.round(totalMs / 1000),
    confirmSecondsLeft: Math.max(0, Math.ceil((totalMs - waitedMs) / 1000)),
  };
}

/* The detection context (baseline/watermark) a record was created with.
 *
 * Records created before providers captured one have no nativeContext, and
 * every provider now refuses to check without it — correctly, since inventing
 * a baseline is what let a recycled address's history pay a new order. But
 * refusing outright would strand invoices that were already in flight across
 * the deploy: they'd never confirm, expire, release their address, and leave
 * any real deposit needing manual reconciliation.
 *
 * TRON is the one provider whose watermark can be reconstructed after the
 * fact: it compares transfer timestamps, and the invoice's own createdAt is a
 * sound lower bound — a transfer that arrived before this order existed was
 * never this order's payment. The others baseline against a balance or block
 * height *as it was at claim time*, which cannot be recovered later, so they
 * keep refusing; that is the safe direction, and only affects records already
 * pending at deploy time.
 */
function nativeContextFor(record) {
  if (!record) return null;
  if (record.nativeContext) return record.nativeContext;
  if (record.provider === 'native_tron' && record.createdAt) {
    const createdMs = new Date(record.createdAt).getTime();
    if (Number.isFinite(createdMs)) return { sinceTimestamp: createdMs };
  }
  return record.nativeContext || null;
}

function sandboxEnabled() {
  // No native provider has a processor-side sandbox toggle — pointing its
  // *_API_BASE/*_RPC_URL at a testnet IS the sandbox mode, and that's a
  // deploy-time choice, not something to report as a runtime flag.
  return false;
}

/**
 * Server-side guard for local payment *simulation* endpoints. These must never
 * be reachable in a real deployment, so we require ALL of:
 *   1. no live native provider configured (there's nothing real to simulate),
 *   2. a non-production environment (NODE_ENV !== 'production'),
 *   3. a loopback PUBLIC_URL — a publicly reachable URL means real users.
 * DEMO_AUTH=true also enables it (explicit local-demo opt-in).
 */
function allowSimulate() {
  if (process.env.DEMO_AUTH === 'true') return true;
  if (isConfigured()) return false;
  if (process.env.NODE_ENV === 'production') return false;
  const url = process.env.PUBLIC_URL || '';
  if (url && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\/?$/i.test(url)) return false;
  return true;
}

module.exports = {
  provider,
  isConfigured,
  publicUrl,
  createEscrowInvoice,
  sandboxEnabled,
  allowSimulate,
  configureNativeProviders,
  paymentProgress,
  nativeContextFor,
  NATIVE_PROVIDERS,
  NATIVE_NETWORK_LABELS,
  nativeTron,
};
