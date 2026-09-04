/* Every transactional email the marketplace sends, in one place.
 *
 * Routes call one named function per event; composition and recipient choice
 * live here, so a route never grows mailer plumbing and the same event can't
 * end up worded two different ways at two call sites.
 *
 * THREE RULES hold for everything in this file:
 *   1. Fire-and-forget. Sends go through mailer.trySend, which resolves
 *      rather than rejects, and every function returns undefined. A mail
 *      outage must never fail — or even slow — a money request.
 *   2. Never before the state change. Call these only once the write that
 *      the email describes has actually committed, or a failed release
 *      sends "you have been paid".
 *   3. Only on the first, real transition. Callers already gate on
 *      firstCharge / duplicate; keep it that way so a retried request does
 *      not re-send.
 */
const mailer = require('./mailer');
const t = require('./email-templates');

const send = (to, msg) => { if (to) mailer.trySend({ to, ...msg }); };

/* Rule 1 above, actually enforced.
 *
 * mailer.trySend can't reject — but the TEMPLATE CALL that builds its argument
 * runs synchronously inside the route, after the write it describes has already
 * committed. A template that throws on some unexpected shape would therefore
 * propagate into the route's catch block and answer HTTP 500 for a release,
 * refund or payout that genuinely succeeded — the caller sees a failure, retries,
 * and gets `duplicate`. An email is never worth that, so every entry point below
 * is wrapped: a broken notification costs the notification and nothing else. */
function guard(fns) {
  const out = {};
  for (const [name, fn] of Object.entries(fns)) {
    out[name] = (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        console.error('notify.' + name + ' failed (email skipped):', err && err.message);
      }
    };
  }
  return out;
}

/* ---- orders ---- */

/* Crypto checkout: the deposit address and exact amount, emailed so the buyer
 * still has it after closing the tab. */
function paymentInstructions(payment) {
  if (!payment?.buyerEmail || !payment.payAddress) return;
  send(payment.buyerEmail, t.paymentInstructionsEmail({
    title: payment.title,
    orderId: payment.orderId,
    address: payment.payAddress,
    amount: payment.payAmount,
    decimals: payment.payDecimals,
    ticker: payment.payCurrency,
    networkLabel: payment.networkLabel || payment.payNetwork,
    amountUsd: payment.payAmountUsd,
    expiresAt: payment.expiresAt,
    confirmMinutes: payment.confirmMinutes,
  }));
}

/* Sale notice to the seller and payment confirmation to the buyer. */
function notifyPaid(payment) {
  if (!payment || !payment.orderId) return;
  const amount = payment.amount != null ? payment.amount : payment.listingAmount;
  send(payment.sellerEmail, t.sellerSaleEmail({
    title: payment.title || 'Item',
    amount,
    orderId: payment.orderId,
    paidAt: payment.paidAt,
    platformFee: payment.platformFee,
    sellerNet: payment.sellerNet,
  }));
  send(payment.buyerEmail, t.paymentConfirmedEmail({
    title: payment.title || 'your order',
    amount,
    listingAmount: payment.listingAmount,
    gatewayFee: payment.gatewayFee,
    buyerTotal: payment.buyerTotal,
    orderId: payment.orderId,
    paidAt: payment.paidAt,
    networkLabel: payment.networkLabel || payment.payNetwork,
    txHash: payment.txHash || payment.nativeTxHash,
  }));
}

/* Buyer delivery email carrying the auto-delivered credential. */
function notifyCredential({ payment, credential }) {
  if (!payment?.buyerEmail || credential == null) return;
  send(payment.buyerEmail, t.credentialEmail({
    title: payment.title || 'your order',
    orderId: payment.orderId,
    credential,
    deliveredAt: new Date(),
  }));
}

/* Seller marked the order delivered — the buyer now has to confirm. */
function orderDelivered({ escrow, proof, sellerName }) {
  if (!escrow?.buyerEmail) return;
  send(escrow.buyerEmail, t.orderDeliveredEmail({
    title: escrow.title,
    orderId: escrow._id,
    amount: escrow.amount,
    deliveredAt: escrow.deliveredAt || new Date(),
    proof,
    sellerName,
  }));
}

/* Buyer confirmed: final receipt to the buyer, payout notice to the seller. */
function escrowReleased({ escrow, gross, fee, net, balance }) {
  if (!escrow) return;
  const releasedAt = escrow.releasedAt || new Date();
  send(escrow.buyerEmail, t.escrowReleasedBuyerEmail({
    title: escrow.title,
    orderId: escrow._id,
    amount: gross != null ? gross : escrow.amount,
    releasedAt,
    sellerName: escrow.sellerName,
  }));
  send(escrow.sellerEmail, t.payoutReleasedEmail({
    title: escrow.title,
    orderId: escrow._id,
    gross: gross != null ? gross : escrow.amount,
    fee,
    net,
    releasedAt,
    balance,
  }));
}

function escrowRefunded({ escrow, amount, reason, destination }) {
  if (!escrow?.buyerEmail) return;
  send(escrow.buyerEmail, t.refundEmail({
    title: escrow.title,
    orderId: escrow._id,
    amount: amount != null ? amount : escrow.amount,
    refundedAt: escrow.refundedAt || new Date(),
    reason,
    destination,
  }));
}

/* ---- disputes ---- */

/* Both sides get told, worded for their side: the seller needs to respond,
 * the buyer needs to know their money did not move. */
function disputeOpened({ escrow, reason }) {
  if (!escrow) return;
  const base = { title: escrow.title, orderId: escrow._id, amount: escrow.amount, openedAt: escrow.disputedAt || new Date(), reason };
  send(escrow.buyerEmail, t.disputeOpenedEmail({ ...base, audience: 'buyer' }));
  send(escrow.sellerEmail, t.disputeOpenedEmail({ ...base, audience: 'seller' }));
}

function disputeResolved({ escrow, outcome, note, amount }) {
  if (!escrow) return;
  const base = {
    title: escrow.title, orderId: escrow._id,
    amount: amount != null ? amount : escrow.amount,
    outcome, note, resolvedAt: new Date(),
  };
  send(escrow.buyerEmail, t.disputeResolvedEmail({ ...base, audience: 'buyer' }));
  send(escrow.sellerEmail, t.disputeResolvedEmail({ ...base, audience: 'seller' }));
}

/* An arbiter's decision, worded for what actually happened.
 *
 * resolveEscrow also accepts a 'held' or 'delivered' escrow — an admin can
 * refund an undelivered order that nobody disputed. Calling that a "dispute
 * resolved" tells both sides about an argument they never had, so the
 * pre-resolution status picks the wording. */
function escrowResolved({ escrow, wasDisputed, outcome, note, payout }) {
  if (!escrow) return;
  if (wasDisputed) return disputeResolved({ escrow, outcome, note });
  if (outcome === 'refunded') return escrowRefunded({ escrow, reason: note });
  return escrowReleased({
    escrow,
    gross: escrow.amount,
    fee: payout ? payout.fee : undefined,
    net: payout ? payout.net : undefined,
  });
}

/* ---- accounts ---- */

/* Sent once the address is proven, not at signup — an unverified address is
 * quite possibly someone else's. */
function welcome({ email, name }) {
  send(email, t.welcomeEmail(name));
}

function sellerApproved({ email, name }) {
  send(email, t.sellerApprovedEmail({ email, name }));
}

function sellerRejected({ email, name, reason }) {
  send(email, t.sellerRejectedEmail({ email, name, reason }));
}

/* ---- money movement ---- */

function withdrawalRequested({ email, amount, address, networkLabel, requestedAt, reference, balance }) {
  send(email, t.withdrawalRequestedEmail({ amount, address, networkLabel, requestedAt, reference, balance }));
}

function withdrawalPaid({ email, amount, address, networkLabel, txHash, paidAt, reference }) {
  send(email, t.withdrawalPaidEmail({ amount, address, networkLabel, txHash, paidAt, reference }));
}

function withdrawalRejected({ email, amount, reason, rejectedAt, reference, balance }) {
  send(email, t.withdrawalRejectedEmail({ amount, reason, rejectedAt, reference, balance }));
}

function walletToppedUp({ email, amount, balance, networkLabel, txHash, creditedAt, orderId }) {
  send(email, t.walletToppedUpEmail({ amount, balance, networkLabel, txHash, creditedAt, orderId }));
}

module.exports = guard({
  paymentInstructions,
  notifyPaid,
  notifyCredential,
  orderDelivered,
  escrowReleased,
  escrowRefunded,
  disputeOpened,
  disputeResolved,
  escrowResolved,
  welcome,
  sellerApproved,
  sellerRejected,
  withdrawalRequested,
  withdrawalPaid,
  withdrawalRejected,
  walletToppedUp,
});
