/* Accept native SOL or USDT-SPL directly on-chain — no payment processor.
 * Same architecture and caveats as lib/payments/native-tron.js (read that
 * file's doc comment first): a pre-generated address pool, no private keys
 * ever touched here, and UNTESTED AGAINST A REAL CHAIN — no outbound network
 * access to any Solana RPC from this development environment. Testnet or
 * devnet-verify before mainnet.
 *
 * Detection is a balance-delta, not a transaction parse: createInvoice
 * records the address's balance at claim time as `context` (lamports for
 * native SOL, token amount for USDT-SPL); checkAddressForPayment re-reads
 * the current balance and treats an increase >= the expected amount as a
 * payment. Simpler and more robust than reconstructing it from
 * getSignaturesForAddress/getTransaction, at the cost of not itself
 * producing a real transaction signature — the most recent signature for
 * the address is attached best-effort for the record, not relied on.
 *
 * USDT-SPL needs the pooled owner address to already have an Associated
 * Token Account (ATA) for the USDT mint — SPL tokens live in a derived
 * account, not the wallet address itself. An address with no ATA yet reads
 * as balance 0 (not an error) until one exists; the operator's wallet
 * software typically creates it automatically on first receive, or it can
 * be pre-created with `spl-token create-account <mint>`.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;
// Well-known, public mainnet USDT SPL mint — not sensitive.
const DEFAULT_USDT_SPL_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

function rpcUrl() {
  return process.env.NATIVE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
}
function usdtSplMint() {
  return process.env.NATIVE_SOL_USDT_MINT || DEFAULT_USDT_SPL_MINT;
}

async function rpcCall(method, params) {
  const r = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`Solana RPC HTTP ${r.status}`);
  const data = await r.json().catch(() => ({}));
  if (data.error) throw new Error(`Solana RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  return data.result;
}

function createSolanaProvider({ network, providerName, kind }) {
  function confirmWindowMs() {
    const secs = Number(process.env.NATIVE_SOL_CONFIRM_SECONDS);
    return (Number.isFinite(secs) && secs >= 0 ? secs : 30) * 1000; // Solana finalizes fast
  }

  let _cryptoAddressStore = null;
  function configure({ cryptoAddressStore }) {
    _cryptoAddressStore = cryptoAddressStore;
  }
  function configured() {
    return process.env.PAYMENT_PROVIDER === providerName && !!_cryptoAddressStore;
  }

  async function readBalance(address) {
    if (kind === 'native') {
      const lamports = await rpcCall('getBalance', [address]);
      return typeof lamports === 'object' ? lamports.value : lamports;
    }
    // USDT-SPL: sum token amounts across every account this owner holds for
    // the mint (normally exactly one — its ATA). Missing/empty is balance 0.
    const res = await rpcCall('getTokenAccountsByOwner', [
      address,
      { mint: usdtSplMint() },
      { encoding: 'jsonParsed' },
    ]);
    const accounts = res?.value || [];
    let total = 0;
    for (const acc of accounts) {
      const amt = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (Number.isFinite(amt)) total += amt;
    }
    return total;
  }

  async function createInvoice({ orderId, amount }) {
    if (!_cryptoAddressStore) throw new Error(`${network} payment provider not configured (no address pool store wired)`);
    const claim = await _cryptoAddressStore.claimForOrder(network, orderId);
    if (claim.empty) throw new Error('No deposit addresses available in the pool — add more via the admin panel');
    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    const priorBalance = await readBalance(claim.doc.address).catch(() => 0);
    return {
      provider: network,
      providerPaymentId: claim.doc.address,
      payUrl: null,
      payAddress: claim.doc.address,
      payAmount: amt,
      context: { priorBalance },
      raw: { network },
    };
  }

  function isPaidStatus(status) {
    return status === 'paid';
  }

  async function checkAddressForPayment(address, expectedAmount, context) {
    if (!address) return { found: false };
    const prior = Number(context?.priorBalance) || 0;
    const current = await readBalance(address);
    const delta = kind === 'native' ? (current - prior) / LAMPORTS_PER_SOL : current - prior;
    const minAmt = Number(expectedAmount) * 0.999;
    if (!Number.isFinite(delta) || delta < minAmt) return { found: false };

    let txId = null;
    try {
      const sigs = await rpcCall('getSignaturesForAddress', [address, { limit: 1 }]);
      txId = sigs?.[0]?.signature || null;
    } catch (_) { /* best-effort only — the balance delta is the real signal */ }
    return { found: true, amount: delta, txId, from: null };
  }

  return { configure, configured, createInvoice, checkAddressForPayment, isPaidStatus, confirmWindowMs, NETWORK: network };
}

const nativeSol = createSolanaProvider({ network: 'sol-native', providerName: 'native_sol', kind: 'native' });
const nativeSolUsdt = createSolanaProvider({ network: 'sol-usdt-spl', providerName: 'native_sol_usdt', kind: 'spl' });

module.exports = { createSolanaProvider, nativeSol, nativeSolUsdt };
