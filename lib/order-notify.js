/* Composes the transactional emails around a paid order: sale notice to the
 * seller, payment confirmation to the buyer, and (on auto-delivery) the
 * credential. All best-effort — a mail failure never blocks a payment. */
const mailer = require('./mailer');
const templates = require('./email-templates');

/* Sale + payment-confirmation emails for a freshly paid order. */
function notifyPaid(payment) {
  if (!payment || !payment.orderId) return;
  const amount = payment.amount != null ? payment.amount : payment.listingAmount;
  if (payment.sellerEmail) {
    mailer.trySend({
      to: payment.sellerEmail,
      subject: `Sale: ${payment.title || payment.orderId}`,
      ...templates.sellerSaleEmail({ title: payment.title || 'Item', amount, orderId: payment.orderId }),
    });
  }
  if (payment.buyerEmail) {
    mailer.trySend({
      to: payment.buyerEmail,
      subject: `Payment confirmed: ${payment.title || payment.orderId}`,
      ...templates.paymentConfirmedEmail({ title: payment.title || 'your order', amount, orderId: payment.orderId, paidAt: payment.paidAt }),
    });
  }
}

/* Buyer delivery email carrying the auto-delivered credential. */
function notifyCredential({ payment, credential }) {
  if (!payment?.buyerEmail || credential == null) return;
  mailer.trySend({
    to: payment.buyerEmail,
    subject: `Your delivery: ${payment.title || payment.orderId}`,
    ...templates.credentialEmail({ title: payment.title || 'your order', orderId: payment.orderId, credential }),
  });
}

module.exports = { notifyPaid, notifyCredential };
