/* Accept Bitcoin or Litecoin directly on-chain — no payment processor. Same
 * architecture and caveats as lib/payments/native-tron.js (read that file's
 * doc comment first): a pre-generated address pool, no private keys ever
 * touched here, and UNTESTED AGAINST A REAL CHAIN — no outbound network
 * access to any Bitcoin/Litecoin API from this development environment.
 * Testnet-verify (Bitcoin testnet/signet, or Litecoin testnet) before
 * mainnet — and double-check whatever *_API_BASE you configure is actually
 * the esplora instance you think it is; the defaults below are believed
 * correct but were never reached from here to confirm.
 *
 * Uses an esplora-style REST API (the shape blockstream.info/api serves,
 * and several public Litecoin explorers mirror) rather than eth_getLogs- or
 * TronGrid-style transaction lists — Bitcoin/Litecoin are UTXO-based, not
 * account-based, so "balance" here is a derived sum, not a ledger read.
 *
 * Detection is a funded-total delta: GET /address/{addr} returns
 * chain_stats.funded_txo_sum (total satoshis ever received, CONFIRMED only
 * — unlike the account-balance approach used for EVM/Solana, esplora
 * already separates chain_stats from mempool_stats, so reading chain_stats
 * is itself a confirmation gate, not just a wall-clock proxy for one).
 * createInvoice records the current funded_txo_sum as `context`;
 * checkAddressForPayment reports found once it has risen by at least the
 * expected amount.
 *
 * That gate is only ONE confirmation, though — chain_stats counts a transfer
 * the moment it's in the latest block, same as any other. That's a much
 * stronger guarantee than an account-based chain's raw event log (no
 * confirmation info at all — see native-evm.js), but still weaker than the
 * multi-confirmation wait exchanges commonly require for deposits, since a
 * single-block reorg — rare, but not impossible, more so for Litecoin's
 * lower hashrate than Bitcoin's — could still in principle evict it. The
 * *_CONFIRM_SECONDS wall-clock wait below defaults to a positive value (not
 * 0) for exactly this: an approximate few-block buffer on top of that first
 * confirmation, using each chain's average block time.
 *
 * BTC/LTC are not USD-pegged, so the USDT listing price createInvoice
 * receives has to be converted to a coin amount via lib/payments/fx.js
 * before it means anything on-chain — see that module's doc comment.
 */

const fx = require('./fx');

function createUtxoProvider({ network, providerName, envPrefix, symbol, defaultApiBase, defaultConfirmSecs }) {
  function apiBase() {
    return (process.env[`${envPrefix}_API_BASE`] || defaultApiBase).replace(/\/$/, '');
  }
  function confirmWindowMs() {
    const secs = Number(process.env[`${envPrefix}_CONFIRM_SECONDS`]);
    return (Number.isFinite(secs) && secs >= 0 ? secs : defaultConfirmSecs) * 1000;
  }

  let _cryptoAddressStore = null;
  function configure({ cryptoAddressStore }) {
    _cryptoAddressStore = cryptoAddressStore;
  }
  function configured() {
    return process.env.PAYMENT_PROVIDER === providerName && !!_cryptoAddressStore;
  }

  async function fundedSatoshis(address) {
    const r = await fetch(`${apiBase()}/address/${encodeURIComponent(address)}`);
    if (!r.ok) throw new Error(`${network} explorer HTTP ${r.status}`);
    const data = await r.json().catch(() => ({}));
    return Number(data?.chain_stats?.funded_txo_sum) || 0;
  }

  async function createInvoice({ orderId, amount }) {
    if (!_cryptoAddressStore) throw new Error(`${network} payment provider not configured (no address pool store wired)`);
    const usdAmount = Math.round((Number(amount) || 0) * 100) / 100;
    // Converted BEFORE claiming a pooled address: if the exchange rate isn't
    // available, nothing should get claimed for an invoice that's about to
    // fail anyway.
    const coinAmount = await fx.convertUsdToCoin(symbol, usdAmount, 8);
    const claim = await _cryptoAddressStore.claimForOrder(network, orderId);
    if (claim.empty) throw new Error('No deposit addresses available in the pool — add more via the admin panel');
    const priorFunded = await fundedSatoshis(claim.doc.address).catch(() => 0);
    return {
      provider: network,
      providerPaymentId: claim.doc.address,
      payUrl: null,
      payAddress: claim.doc.address,
      payAmount: coinAmount,
      payAmountUsd: usdAmount,
      context: { priorFunded },
      raw: { network },
    };
  }

  function isPaidStatus(status) {
    return status === 'paid';
  }

  async function checkAddressForPayment(address, expectedAmount, context) {
    if (!address) return { found: false };
    const prior = Number(context?.priorFunded) || 0;
    const current = await fundedSatoshis(address);
    const deltaBtc = (current - prior) / 1e8;
    const minAmt = Number(expectedAmount) * 0.999;
    if (!Number.isFinite(deltaBtc) || deltaBtc < minAmt) return { found: false };
    return { found: true, amount: deltaBtc, txId: null, from: null };
  }

  return { configure, configured, createInvoice, checkAddressForPayment, isPaidStatus, confirmWindowMs, NETWORK: network };
}

const nativeBtc = createUtxoProvider({
  network: 'btc',
  providerName: 'native_btc',
  envPrefix: 'NATIVE_BTC',
  symbol: 'BTC',
  defaultApiBase: 'https://blockstream.info/api',
  // ~3 extra blocks' worth of wall-clock time at Bitcoin's ~10min average —
  // chain_stats already guarantees 1 confirmation (see doc comment); this is
  // margin on top, not the primary gate.
  defaultConfirmSecs: 30 * 60,
});

const nativeLtc = createUtxoProvider({
  network: 'ltc',
  providerName: 'native_ltc',
  envPrefix: 'NATIVE_LTC',
  symbol: 'LTC',
  // Believed to mirror the same esplora API shape — NOT verified live from
  // this environment. Confirm before relying on it; override via
  // NATIVE_LTC_API_BASE if wrong or unavailable.
  defaultApiBase: 'https://litecoinspace.org/api',
  // ~3 extra blocks at Litecoin's ~2.5min average — same margin rationale as
  // BTC above, scaled to LTC's faster block time.
  defaultConfirmSecs: 8 * 60,
});

module.exports = { createUtxoProvider, nativeBtc, nativeLtc };
