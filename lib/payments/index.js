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
  const native = NATIVE_PROVIDERS[provider()];
  if (native) {
    return native.createInvoice({ orderId, amount });
  }
  throw new Error('No crypto payment provider configured');
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
  NATIVE_PROVIDERS,
  nativeTron,
};
