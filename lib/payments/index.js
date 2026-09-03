const oxapay = require('./oxapay');
const cryptomus = require('./cryptomus');
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
 * name, so nothing else needs to change. */
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
  return (process.env.PAYMENT_PROVIDER || 'oxapay').toLowerCase();
}

/* Called once at boot (server.js), after the crypto address pool store
 * exists. Every native provider gets the same store reference — harmless
 * for the ones not actually selected by PAYMENT_PROVIDER, since each one's
 * own `configured()` still gates on its own provider name. */
function configureNativeProviders({ cryptoAddressStore }) {
  for (const p of Object.values(NATIVE_PROVIDERS)) p.configure({ cryptoAddressStore });
}

function isConfigured() {
  const p = provider();
  if (p === 'cryptomus') return cryptomus.configured();
  const native = NATIVE_PROVIDERS[p];
  if (native) return native.configured();
  return oxapay.configured();
}

function publicUrl() {
  return (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

async function createEscrowInvoice({ orderId, amount, description, method }) {
  const callbackUrl = `${publicUrl()}/api/webhooks/${provider()}`;
  const successUrl = `${publicUrl()}/#deals`;

  if (provider() === 'cryptomus') {
    return cryptomus.createInvoice({ orderId, amount, callbackUrl, successUrl });
  }
  const native = NATIVE_PROVIDERS[provider()];
  if (native) {
    return native.createInvoice({ orderId, amount });
  }
  return oxapay.createInvoice({
    orderId,
    amount,
    description,
    callbackUrl,
    successUrl,
    method: method || 'trc20',
  });
}

function sandboxEnabled() {
  if (provider() === 'oxapay') return oxapay.sandboxMode();
  // No native provider has a processor-side sandbox toggle — pointing its
  // *_API_BASE/*_RPC_URL at a testnet IS the sandbox mode, and that's a
  // deploy-time choice, not something to report as a runtime flag.
  if (NATIVE_PROVIDERS[provider()]) return false;
  return process.env.OXAPAY_SANDBOX !== 'false';
}

/**
 * Server-side guard for local payment *simulation* endpoints. These must never
 * be reachable in a real deployment, so we require ALL of:
 *   1. sandbox mode explicitly on (OXAPAY_SANDBOX not 'false'),
 *   2. a non-production environment (NODE_ENV !== 'production'),
 *   3. a loopback PUBLIC_URL — a publicly reachable URL means real users.
 * DEMO_AUTH=true also enables it (explicit local-demo opt-in).
 */
function allowSimulate() {
  if (process.env.DEMO_AUTH === 'true') return true;
  if (process.env.OXAPAY_SANDBOX === 'false') return false;
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
  oxapay,
  cryptomus,
  nativeTron,
};
