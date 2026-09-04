/* Shared amount comparison for the native on-chain providers.
 *
 * Every provider used to accept `received >= expected * 0.999`. That was
 * described as absorbing the chain's decimal rounding, but a proportional
 * band is a proportional DISCOUNT: 0.1% of a 10,000 USDT order is 10 USDT of
 * goods released for money that never arrived, and it scales with the order
 * rather than with the rounding it was meant to absorb.
 *
 * Rounding error is bounded by the precision the invoice was QUOTED at, not
 * by the order's size. An invoice quoted to `decimals` places can be off by
 * at most one unit in the last place, so that — one ulp — is the entire
 * allowance: 0.01 for a 2-decimal USDT quote, 0.00000001 for an 8-decimal
 * BTC quote. Anything short of that is an underpayment, not a rounding
 * artifact.
 *
 * Uses integer arithmetic at the quoted precision rather than comparing
 * floats directly, so a value that only LOOKS short because of binary
 * floating-point representation (0.1 + 0.2 < 0.3) never reads as an
 * underpayment.
 */

/** Smallest shortfall that is still explainable as quote rounding. */
function toleranceFor(decimals) {
  const d = Number.isFinite(Number(decimals)) && Number(decimals) >= 0 ? Number(decimals) : 2;
  return 10 ** -d;
}

/**
 * Whether `received` covers `expected` for an invoice quoted to `decimals`
 * places. Overpayment always passes; a shortfall passes only if it is within
 * one unit in the last place of the quote.
 */
function coversExpected(received, expected, decimals) {
  const got = Number(received);
  const want = Number(expected);
  if (!Number.isFinite(got) || !Number.isFinite(want)) return false;
  if (want <= 0) return false; // never treat a zero/negative quote as payable
  const d = Number.isFinite(Number(decimals)) && Number(decimals) >= 0 ? Number(decimals) : 2;
  const scale = 10 ** d;
  // Round both to the quoted precision before comparing, so the check is
  // exact at the precision the buyer was actually asked to pay to.
  const gotUnits = Math.round(got * scale);
  const wantUnits = Math.round(want * scale);
  return gotUnits >= wantUnits - 1; // one ulp of slack, nothing more
}

module.exports = { coversExpected, toleranceFor };
