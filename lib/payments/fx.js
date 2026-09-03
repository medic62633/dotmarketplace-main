/* Converts a USD amount (this app prices every listing in USDT, treated as
 * 1:1 with USD like the rest of the codebase already does) into the native
 * coin amount for the native chains whose currency is NOT a USD-pegged
 * stablecoin — native BTC, native LTC, and native SOL (the plain-SOL
 * provider, not USDT-SPL). Every USDT-denominated native chain (TRC-20,
 * ERC-20, BEP-20, SPL-USDT) never calls this — 1 USDT already equals 1 unit
 * to send.
 *
 * Without this, lib/payments/native-utxo.js and lib/payments/native-solana.js
 * (kind: 'native') would treat a dollar figure as if it were already coin
 * units — a $20 listing would ask a buyer to send 20 BTC. That bug is
 * exactly what this module exists to fix.
 *
 * Uses CoinGecko's public (no API key) simple-price endpoint, with a short
 * cache so a burst of checkouts doesn't hammer it or trip a rate limit, and
 * a bounded stale-cache fallback so one transient fetch failure doesn't take
 * down checkout entirely. It never falls back to a 1:1 rate or an invented
 * number — no usable price (fresh or within the stale window) means the
 * invoice fails loudly (same "fail loud, not silently wrong" policy as an
 * empty address pool), rather than quoting a buyer a wildly wrong amount.
 *
 * NATIVE_{BTC,LTC,SOL}_USD_RATE lets an operator pin a fixed rate instead of
 * calling out at all — useful as a manual override/fallback, and the only
 * way to exercise this deterministically in tests (this environment has no
 * outbound access to api.coingecko.com to verify the live path against).
 */

const COINGECKO_IDS = { BTC: 'bitcoin', LTC: 'litecoin', SOL: 'solana' };
const CACHE_TTL_MS = 60 * 1000;
// How long a cached price may be reused if the live fetch fails — long
// enough to ride out a transient API hiccup, short enough that a genuinely
// prolonged outage still fails checkout rather than quoting a stale rate.
const STALE_MAX_MS = 15 * 60 * 1000;

const cache = new Map(); // symbol -> { price, at }

function envOverride(symbol) {
  const v = Number(process.env[`NATIVE_${symbol}_USD_RATE`]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function fetchLivePrice(symbol) {
  const id = COINGECKO_IDS[symbol];
  if (!id) throw new Error(`No price source configured for ${symbol}`);
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`price API HTTP ${r.status}`);
  const data = await r.json().catch(() => ({}));
  const price = data?.[id]?.usd;
  if (!Number.isFinite(price) || price <= 0) throw new Error(`price API returned no usable ${symbol}/USD price`);
  return price;
}

/** Current USD price of one unit of `symbol` (BTC/LTC/SOL). Throws if no
 * live or acceptably-fresh cached price is available — callers must not
 * catch this into a default. */
async function usdPrice(symbol) {
  const override = envOverride(symbol);
  if (override) return override;

  const cached = cache.get(symbol);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.price;
  try {
    const price = await fetchLivePrice(symbol);
    cache.set(symbol, { price, at: now });
    return price;
  } catch (err) {
    if (cached && now - cached.at < STALE_MAX_MS) {
      console.error(`fx: live ${symbol}/USD fetch failed, using a ${Math.round((now - cached.at) / 1000)}s-old cached price —`, err.message);
      return cached.price;
    }
    throw new Error(`Could not get a live ${symbol}/USD exchange rate right now — try again shortly`);
  }
}

/** Converts a USD(T) amount into the equivalent amount of `symbol`, rounded
 * to `decimals` places. Throws (never silently returns a wrong/1:1 amount)
 * if no usable price is available — see usdPrice(). */
async function convertUsdToCoin(symbol, usdAmount, decimals) {
  const price = await usdPrice(symbol);
  const coinAmount = (Number(usdAmount) || 0) / price;
  if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
    throw new Error(`Could not convert ${usdAmount} USD to ${symbol} — invalid amount`);
  }
  const factor = 10 ** decimals;
  return Math.round(coinAmount * factor) / factor;
}

module.exports = { usdPrice, convertUsdToCoin };
