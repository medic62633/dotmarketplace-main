const oxapay = require('./oxapay');
const cryptomus = require('./cryptomus');
const nativeTron = require('./native-tron');

function provider() {
  return (process.env.PAYMENT_PROVIDER || 'oxapay').toLowerCase();
}

function isConfigured() {
  const p = provider();
  if (p === 'cryptomus') return cryptomus.configured();
  if (p === 'native_tron') return nativeTron.configured();
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
  if (provider() === 'native_tron') {
    return nativeTron.createInvoice({ orderId, amount });
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
  // native_tron has no processor-side sandbox toggle — pointing
  // NATIVE_TRON_API_BASE at Shasta/Nile testnet IS the sandbox mode, and
  // that's a deploy-time choice, not something to report as a runtime flag.
  if (provider() === 'native_tron') return false;
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
  oxapay,
  cryptomus,
  nativeTron,
};
