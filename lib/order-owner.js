/* Both checkout paths take the order/deal id from the client: it keys the
 * escrow, the payment record, the deal conversation and the credential-stock
 * reservation, and it doubles as the idempotency key that makes a retried
 * purchase safe to replay.
 *
 * That makes "is this id already someone else's?" a money-safety question.
 * Without this check, a buyer paying on an id already in use had their own
 * wallet debited while the escrow, the payment record and the seller-side sale
 * all stayed bound to the original buyer — money out, and nothing of their own
 * to release, dispute or refund. The crypto path guarded its payment record
 * this way already; the wallet path guarded nothing, and neither looked at the
 * escrow.
 *
 * Client-generated ids are 64-bit random now (public/js/app.js's newDealId),
 * so an honest client never lands here — this is the half that does not
 * trust the client at all.
 *
 * Returns null when the id is free or already belongs to this buyer, or
 * { code, msg } describing why it must be refused. Call it BEFORE reserving
 * stock or moving any money.
 */

/* Deliberately vague: a legitimate buyer never sees this, and confirming
 * "that id is another account's" would turn the endpoint into an oracle for
 * probing which order ids exist. */
const TAKEN = {
  code: 'order_taken',
  msg: 'That order reference is already in use — start the purchase again.',
};

async function checkOrderOwner({ sellerStore, paymentStore, orderId, buyerEmail }) {
  if (!orderId || !buyerEmail) return null;

  const escrow = typeof sellerStore?.getEscrow === 'function'
    ? await sellerStore.getEscrow(orderId)
    : null;
  if (escrow && escrow.buyerEmail && escrow.buyerEmail !== buyerEmail) return TAKEN;

  const payment = typeof paymentStore?.getByOrderId === 'function'
    ? await paymentStore.getByOrderId(orderId)
    : null;
  if (payment && payment.buyerEmail && payment.buyerEmail !== buyerEmail) return TAKEN;

  return null;
}

module.exports = { checkOrderOwner };
