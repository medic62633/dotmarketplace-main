const crypto = require('crypto');

function merchantId() {
  return process.env.CRYPTOMUS_MERCHANT_ID || '';
}

function apiKey() {
  return process.env.CRYPTOMUS_API_KEY || '';
}

function configured() {
  return !!(merchantId() && apiKey());
}

function sign(body) {
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64');
  return crypto.createHash('md5').update(b64 + apiKey()).digest('hex');
}

async function createInvoice({ orderId, amount, callbackUrl, successUrl }) {
  if (!configured()) throw new Error('Cryptomus credentials not configured');
  const payload = {
    amount: String(amount),
    currency: 'USD',
    order_id: orderId,
    url_callback: callbackUrl,
    url_return: successUrl || callbackUrl,
    is_payment_multiple: false,
    lifetime: 3600,
    to_currency: 'USDT',
  };
  const signVal = sign(payload);
  const r = await fetch('https://api.cryptomus.com/v1/payment', {
    method: 'POST',
    headers: {
      merchant: merchantId(),
      sign: signVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  const result = data.result || data;
  if (!r.ok || !result?.url) {
    throw new Error(data.message || data.error || 'Cryptomus invoice failed');
  }
  return {
    provider: 'cryptomus',
    providerPaymentId: result.uuid || result.order_id,
    payUrl: result.url,
    raw: result,
  };
}

function verifyWebhook(body, signature) {
  if (!signature || !apiKey()) return false;
  const copy = { ...body };
  delete copy.sign;
  const expected = sign(copy);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch (_) {
    return false;
  }
}

function isPaidStatus(status) {
  const s = String(status || '').toLowerCase();
  return ['paid', 'paid_over'].includes(s);
}

module.exports = { configured, createInvoice, verifyWebhook, isPaidStatus };
