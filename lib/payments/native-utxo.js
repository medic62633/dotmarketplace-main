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
 */

function createUtxoProvider({ network, providerName, envPrefix, defaultApiBase, defaultConfirmSecs }) {
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
    const claim = await _cryptoAddressStore.claimForOrder(network, orderId);
    if (claim.empty) throw new Error('No deposit addresses available in the pool — add more via the admin panel');
    const amt = Math.round((Number(amount) || 0) * 1e8) / 1e8;
    const priorFunded = await fundedSatoshis(claim.doc.address).catch(() => 0);
    return {
      provider: network,
      providerPaymentId: claim.doc.address,
      payUrl: null,
      payAddress: claim.doc.address,
      payAmount: amt,
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
  defaultApiBase: 'https://blockstream.info/api',
  defaultConfirmSecs: 0, // chain_stats is already confirmed-only; see doc comment
});

const nativeLtc = createUtxoProvider({
  network: 'ltc',
  providerName: 'native_ltc',
  envPrefix: 'NATIVE_LTC',
  // Believed to mirror the same esplora API shape — NOT verified live from
  // this environment. Confirm before relying on it; override via
  // NATIVE_LTC_API_BASE if wrong or unavailable.
  defaultApiBase: 'https://litecoinspace.org/api',
  defaultConfirmSecs: 0,
});

module.exports = { createUtxoProvider, nativeBtc, nativeLtc };
