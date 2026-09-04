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
 *
 * Native SOL is not USD-pegged (unlike USDT-SPL), so the USDT listing price
 * createInvoice receives has to be converted to a SOL amount via
 * lib/payments/fx.js before it means anything on-chain — see that module's
 * doc comment. USDT-SPL skips this entirely (1 USDT already = 1 to send).
 */

const fx = require('./fx');
const { coversExpected } = require('./amounts');

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
  // Native SOL invoices are quoted to 6 places (see createInvoice's
  // convertUsdToCoin call); USDT-SPL is a USD-pegged 2-place quote. The
  // rounding allowance on a payment has to match whichever precision the
  // buyer was actually asked to pay to — see lib/payments/amounts.js.
  const quoteDecimals = kind === 'native' ? 6 : 2;

  function confirmWindowMs() {
    const secs = Number(process.env.NATIVE_SOL_CONFIRM_SECONDS);
    // Small margin on top of the 'finalized' commitment readBalance() already
    // requires (see there) — that commitment level is itself Solana's
    // strongest, reorg-safe guarantee, so this is a buffer, not the primary
    // gate the way it is for TRON.
    return (Number.isFinite(secs) && secs >= 0 ? secs : 10) * 1000;
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
      // Explicit 'finalized' — the strongest, reorg-safe commitment level —
      // rather than trusting whatever the RPC's own default happens to be
      // today. A silent future default change to 'confirmed' or 'processed'
      // would otherwise quietly weaken this to a level that CAN still be
      // rolled back, with nothing here to notice.
      const lamports = await rpcCall('getBalance', [address, { commitment: 'finalized' }]);
      return typeof lamports === 'object' ? lamports.value : lamports;
    }
    // USDT-SPL: sum token amounts across every account this owner holds for
    // the mint (normally exactly one — its ATA). Missing/empty is balance 0.
    const res = await rpcCall('getTokenAccountsByOwner', [
      address,
      { mint: usdtSplMint() },
      { encoding: 'jsonParsed', commitment: 'finalized' },
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
    const usdAmount = Math.round((Number(amount) || 0) * 100) / 100;
    // Native SOL isn't USD-pegged — convert before claiming an address, so a
    // failed rate lookup never ties one up for an invoice that won't be
    // created. USDT-SPL is already USD-pegged: 1:1, no conversion.
    const payAmount = kind === 'native' ? await fx.convertUsdToCoin('SOL', usdAmount, 6) : usdAmount;
    const claim = await _cryptoAddressStore.claimForOrder(network, orderId);
    if (claim.empty) throw new Error('No deposit addresses available in the pool — add more via the admin panel');
    // The balance at claim time is the baseline the whole detection method
    // subtracts from. It used to swallow an RPC failure and fall back to 0,
    // which is the single most dangerous value it could take: pooled
    // addresses are recycled and carry a real balance, so a baseline of 0
    // makes the address's ENTIRE existing balance read as this order's
    // payment and marks it paid before the buyer sends anything.
    //
    // Failing the checkout instead is recoverable — claimForOrder is
    // idempotent, so a retry reuses the same address and re-reads the
    // balance. Same "fail loud, never silently wrong" rule as
    // lib/payments/fx.js's missing exchange rate.
    let priorBalance;
    try {
      priorBalance = await readBalance(claim.doc.address);
    } catch (err) {
      throw new Error(`${network}: could not read the deposit address's starting balance — ${err.message}`);
    }
    if (!Number.isFinite(Number(priorBalance))) {
      throw new Error(`${network}: RPC returned an unusable starting balance for the deposit address`);
    }
    return {
      provider: network,
      providerPaymentId: claim.doc.address,
      payUrl: null,
      payAddress: claim.doc.address,
      payAmount,
      payAmountUsd: kind === 'native' ? usdAmount : undefined,
      context: { priorBalance },
      raw: { network },
    };
  }

  function isPaidStatus(status) {
    return status === 'paid';
  }

  async function checkAddressForPayment(address, expectedAmount, context) {
    if (!address) return { found: false };
    // No baseline means no way to tell this order's payment from the balance
    // that was already there — refuse rather than treat 0 as the baseline,
    // which would credit the address's whole existing balance to this order.
    const prior = Number(context?.priorBalance);
    if (!Number.isFinite(prior)) {
      throw new Error(`${network}: payment record has no priorBalance baseline — cannot safely check for payment`);
    }
    const current = await readBalance(address);
    const delta = kind === 'native' ? (current - prior) / LAMPORTS_PER_SOL : current - prior;
    if (!Number.isFinite(delta) || delta <= 0) return { found: false };
    if (!coversExpected(delta, expectedAmount, quoteDecimals)) return { found: false };

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
