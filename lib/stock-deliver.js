/* Shared auto-delivery + reveal helpers for credential stock.
 *
 * Kept separate from the route registration so both the crypto payment hook
 * (payment-routes via onPaymentPaid) and the wallet pay route can deliver
 * without a circular dependency, and so the reveal endpoint can re-authorize
 * using the same source of truth (the paid payment record).
 */

/* Claim one stocked credential for a confirmed order. No-op for orders without
 * a listingId or listings with no stock pool (manual-delivery flow). Returns
 * { delivered, outOfStock } — never throws on a business-logic miss.
 * Optional onDelivered({ payment, credential }) fires after a successful claim
 * (used to email the credential); it is awaited but its errors are swallowed. */
async function autoDeliver({ paymentStore, sellerStore, stockStore, orderId, onDelivered }) {
  if (!stockStore || !paymentStore) return { delivered: false };
  const payment = await paymentStore.getByOrderId(orderId);
  if (!payment || payment.status !== 'paid' || !payment.listingId) return { delivered: false };

  const listingId = String(payment.listingId);
  const variantId = payment.variantId || null;
  // Manual-delivery listing/variant (never stocked) -> nothing to auto-deliver.
  if (!(await everStocked(stockStore, listingId, variantId))) return { delivered: false, manual: true };

  const claim = await stockStore.claimOne(listingId, orderId, payment.buyerEmail, variantId);
  if (claim.doc) {
    if (typeof onDelivered === 'function') {
      try {
        const credential = stockStore.reveal(claim.doc);
        await onDelivered({ payment, credential });
      } catch (err) {
        console.error('   onDelivered error:', err.message);
      }
    }
    return { delivered: true, orderId };
  }
  if (claim.empty) {
    // Paid but nothing to give: flag so an operator can refund/restock. Never
    // strand funds silently.
    try {
      payment.outOfStock = true;
      await paymentStore.save(payment);
    } catch (_) {}
    return { delivered: false, outOfStock: true };
  }
  return { delivered: false };
}

/* Whether the listing (or one specific variant, e.g. a gift-card denomination)
 * has a stock pool at all (any unit, available or sold). Distinguishes
 * "auto-delivery currently empty" from "manual delivery". */
async function everStocked(stockStore, listingId, variantId) {
  if (typeof stockStore.hasAny === 'function') return stockStore.hasAny(listingId, variantId);
  return (await stockStore.countAvailable(listingId, variantId)) > 0;
}

/* True when a listing/variant is stock-tracked AND has nothing available —
 * used to refuse a purchase before charging. Returns false when there's no
 * pool at all, so the manual-delivery flow is untouched. */
async function isOutOfStock({ stockStore, listingId, variantId }) {
  if (!stockStore) return false;
  const available = await stockStore.countAvailable(String(listingId), variantId);
  if (available > 0) return false;
  return everStocked(stockStore, String(listingId), variantId);
}

module.exports = { autoDeliver, isOutOfStock, everStocked };
