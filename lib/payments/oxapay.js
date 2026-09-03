const crypto = require('crypto');
const { formatNetworkLabel } = require('../payment-labels');

const API_BASE = 'https://api.oxapay.com/v1';

function apiKey() {
  return process.env.OXAPAY_MERCHANT_API_KEY || process.env.OXAPAY_API_KEY || '';
}

function configured() {
  return !!apiKey();
}

function sandboxMode() {
  return process.env.OXAPAY_SANDBOX !== 'false';
}

async function createInvoice({ orderId, amount, description, callbackUrl, successUrl, method }) {
  if (!configured()) throw new Error('OxaPay merchant API key not configured');

  const body = {
    amount: Math.round(parseFloat(amount) * 100) / 100,
    currency: 'USD',
    order_id: String(orderId),
    description: String(description || '').slice(0, 500),
    callback_url: callbackUrl,
    return_url: successUrl || callbackUrl,
    fee_paid_by_payer: 1,
    sandbox: sandboxMode(),
  };

  if (method === 'ton') {
    body.to_currency = 'TON';
  } else {
    body.to_currency = 'USDT';
  }
  // Hint the network so the payer lands on the right chain. OxaPay still lets
  // them switch, but this makes the requested method the default.
  const networkByMethod = { trc20: 'TRON', bep20: 'BSC', ton: 'TON' };
  if (networkByMethod[method]) body.network = networkByMethod[method];

  const r = await fetch(`${API_BASE}/payment/invoice`, {
    method: 'POST',
    headers: {
      merchant_api_key: apiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status !== 200 || !data.data?.payment_url) {
    const msg = data.error?.message || data.message || `OxaPay HTTP ${r.status}`;
    throw new Error(msg);
  }

  return {
    provider: 'oxapay',
    providerPaymentId: String(data.data.track_id || ''),
    payUrl: data.data.payment_url,
    payAddress: null,
    payAmount: body.amount,
    raw: data,
  };
}

function verifyWebhook(rawBody, hmacHeader) {
  const key = apiKey();
  if (!key || !hmacHeader || !rawBody) return false;
  const calculated = crypto.createHmac('sha512', key).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(calculated, 'utf8');
    const b = Buffer.from(String(hmacHeader), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return calculated === hmacHeader;
  }
}

function isPaidStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'paid' || s === 'completed' || s === 'confirmed' || s === 'success';
}

async function getPaymentInfo(trackId) {
  if (!configured() || !trackId) return null;

  const r = await fetch(`${API_BASE}/payment/${encodeURIComponent(String(trackId))}`, {
    method: 'GET',
    headers: {
      merchant_api_key: apiKey(),
      'Content-Type': 'application/json',
    },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status !== 200 || !data.data) return null;
  return data.data;
}

function extractPaymentDetails(payload) {
  if (!payload) return {};
  const txs = Array.isArray(payload.txs) ? payload.txs : [];
  const paidStatuses = ['confirmed', 'paid', 'completed', 'success'];
  const paidTx = txs.find((t) => paidStatuses.includes(String(t.status || '').toLowerCase()))
    || txs[txs.length - 1];
  if (paidTx?.network) {
    const currency = paidTx.currency || paidTx.auto_convert_currency || 'USDT';
    return {
      payNetwork: formatNetworkLabel(paidTx.network, currency),
      payTxNetwork: paidTx.network,
      payCurrency: currency,
    };
  }
  return {};
}

async function enrichRecordNetwork(record) {
  if (!record || record.payNetwork || !record.providerPaymentId) return record;
  const info = await getPaymentInfo(record.providerPaymentId);
  if (!info) return record;
  const details = extractPaymentDetails(info);
  if (details.payNetwork) Object.assign(record, details);
  return record;
}

/**
 * Best-effort extraction of the fiat amount the provider actually confirmed as
 * paid, from a payment-info / webhook payload. Returns null when no trustworthy
 * amount is present (caller should then fall back to the invoice amount).
 */
function extractPaidAmount(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.amount, payload.value, payload.pay_amount, payload.paid_amount,
    payload.price, payload.invoice_amount, payload.fiat_amount,
  ];
  for (const c of candidates) {
    const n = parseFloat(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  if (Array.isArray(payload.txs)) {
    // Only sum transactions the provider actually confirmed. Pending / failed /
    // expired txs must not count toward the credited total — otherwise a
    // poll/webhook race that lands on 'paid' while the tx list still carries
    // unconfirmed entries would credit the wallet more than was verified.
    const confirmedStatuses = ['confirmed', 'paid', 'completed', 'success'];
    const total = payload.txs.reduce((s, t) => {
      const st = String(t?.status || '').toLowerCase();
      if (!confirmedStatuses.includes(st)) return s;
      const n = parseFloat(t?.amount ?? t?.value);
      return Number.isFinite(n) && n > 0 ? s + n : s;
    }, 0);
    if (total > 0) return Math.round(total * 100) / 100;
  }
  return null;
}

module.exports = {
  configured,
  createInvoice,
  verifyWebhook,
  isPaidStatus,
  getPaymentInfo,
  extractPaymentDetails,
  extractPaidAmount,
  enrichRecordNetwork,
  sandboxMode,
};
