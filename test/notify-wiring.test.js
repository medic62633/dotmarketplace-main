/* The templates are useless if nothing sends them, and a send at the wrong
 * moment is worse than none — "you have been paid" for a release that failed.
 *
 * These drive lib/notify.js against a stub mailer and assert three things the
 * route wiring depends on:
 *   - every event addresses the right people,
 *   - a missing recipient is a no-op rather than a throw,
 *   - a mailer that throws cannot take a money request down with it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MAILER = require.resolve('../lib/mailer');
const NOTIFY = require.resolve('../lib/notify');

/* Swap the mailer for a recorder before lib/notify.js is first required. */
function withStubMailer(run, { throwOnSend = false } = {}) {
  const sent = [];
  const realMailer = require.cache[MAILER];
  require.cache[MAILER] = {
    id: MAILER, filename: MAILER, loaded: true, exports: {
      trySend: (msg) => {
        if (throwOnSend) throw new Error('SMTP exploded');
        sent.push(msg);
      },
      sendMail: async () => ({ sent: true }),
      mailerEnabled: () => true,
      config: () => ({}),
    },
  };
  delete require.cache[NOTIFY];
  const notify = require(NOTIFY);
  try {
    run(notify, sent);
  } finally {
    if (realMailer) require.cache[MAILER] = realMailer; else delete require.cache[MAILER];
    delete require.cache[NOTIFY];
  }
  return sent;
}

const escrow = {
  _id: 'DK-abc123', title: 'Netflix Premium', amount: 24.99,
  buyerEmail: 'buyer@example.com', sellerEmail: 'seller@example.com',
};
const to = (sent) => sent.map(m => m.to).sort();

test('a paid order emails both the seller and the buyer', () => {
  const sent = withStubMailer((notify) => {
    notify.notifyPaid({
      orderId: 'DK-1', title: 'Item', amount: 24.99,
      buyerEmail: 'buyer@example.com', sellerEmail: 'seller@example.com',
      listingAmount: 24.99, buyerTotal: 25.49, gatewayFee: 0.5, platformFee: 0.62, sellerNet: 24.37,
      paidAt: new Date(),
    });
  });
  assert.deepEqual(to(sent), ['buyer@example.com', 'seller@example.com']);
  const buyer = sent.find(m => m.to === 'buyer@example.com');
  const seller = sent.find(m => m.to === 'seller@example.com');
  assert.match(buyer.subject, /Payment confirmed/);
  assert.match(seller.subject, /^Sale —/);
  // The buyer is billed only for what they paid; the platform fee is the
  // seller's cost and belongs only in the seller's copy.
  assert.ok(!/Platform fee/i.test(buyer.html), 'buyer copy omits the seller fee');
  assert.ok(/Platform fee/i.test(seller.html), 'seller copy shows it');
});

test('a dispute tells both sides, each in their own words', () => {
  const sent = withStubMailer((notify) => notify.disputeOpened({ escrow, reason: 'never arrived' }));
  assert.deepEqual(to(sent), ['buyer@example.com', 'seller@example.com']);
  const buyer = sent.find(m => m.to === 'buyer@example.com');
  const seller = sent.find(m => m.to === 'seller@example.com');
  assert.notEqual(buyer.subject, seller.subject);
  assert.ok(/What you reported/.test(buyer.html));
  assert.ok(/What the buyer reported/.test(seller.html));
});

test('a release sends the buyer a receipt and the seller a payout notice', () => {
  const sent = withStubMailer((notify) =>
    notify.escrowReleased({ escrow, gross: 24.99, fee: 0.62, net: 24.37, balance: 100 }));
  assert.deepEqual(to(sent), ['buyer@example.com', 'seller@example.com']);
  const seller = sent.find(m => m.to === 'seller@example.com');
  assert.ok(seller.html.includes('24.37 USDT'), 'the seller is told their net');
  assert.ok(seller.html.includes('0.62 USDT'), 'and the fee it came from');
});

test('an event with no recipient is a silent no-op, not a throw', () => {
  const sent = withStubMailer((notify) => {
    // Every one of these is reachable: an escrow can predate buyerEmail being
    // recorded, and resolveEscrow returns no escrow at all on the release path.
    notify.orderDelivered({ escrow: { ...escrow, buyerEmail: null } });
    notify.escrowRefunded({ escrow: { ...escrow, buyerEmail: undefined } });
    notify.escrowResolved({ escrow: null, outcome: 'released' });
    notify.notifyCredential({ payment: { buyerEmail: null }, credential: 'x' });
    notify.notifyCredential({ payment: { buyerEmail: 'b@e.com' }, credential: null });
    notify.paymentInstructions({ buyerEmail: 'b@e.com' }); // no payAddress yet
    notify.notifyPaid(null);
  });
  assert.deepEqual(sent, [], 'nothing was sent, and nothing threw');
});

test('a mailer failure cannot propagate into the money path', () => {
  // Routes call these AFTER the write commits and do not await them. If a send
  // could throw synchronously it would reject the request that already moved
  // the money.
  assert.doesNotThrow(() => {
    withStubMailer((notify) => {
      notify.escrowReleased({ escrow, gross: 24.99, fee: 0.62, net: 24.37 });
      notify.notifyPaid({ orderId: 'o', buyerEmail: 'b@e.com', sellerEmail: 's@e.com', amount: 1 });
    }, { throwOnSend: true });
  });
});

test('an admin refund of an undisputed order is not called a dispute', () => {
  // resolveEscrow also accepts a 'held' or 'delivered' escrow, so an admin can
  // refund an undelivered order nobody argued about. Calling that "dispute
  // resolved" tells both sides about an argument they never had.
  const undisputed = { ...escrow, status: 'held' };
  const plain = withStubMailer((notify) =>
    notify.escrowResolved({ escrow: undisputed, wasDisputed: false, outcome: 'refunded', note: 'seller went quiet' }));
  assert.equal(plain.length, 1, 'only the buyer, who is getting their money back');
  assert.equal(plain[0].to, 'buyer@example.com');
  assert.match(plain[0].subject, /^Refunded —/);
  assert.ok(!/dispute/i.test(plain[0].subject));

  // The same call on a disputed escrow keeps the dispute wording, both sides.
  const disputed = withStubMailer((notify) =>
    notify.escrowResolved({ escrow: { ...escrow, status: 'dispute' }, wasDisputed: true, outcome: 'refunded', note: 'no evidence' }));
  assert.deepEqual(to(disputed), ['buyer@example.com', 'seller@example.com']);
  assert.match(disputed[0].subject, /Dispute resolved/);

  // And an admin releasing an undisputed escrow sends the ordinary pair.
  const released = withStubMailer((notify) =>
    notify.escrowResolved({ escrow: undisputed, wasDisputed: false, outcome: 'released', payout: { fee: 0.62, net: 24.37 } }));
  assert.deepEqual(to(released), ['buyer@example.com', 'seller@example.com']);
  assert.ok(released.some(m => /Paid out/.test(m.subject)));
});

test('the routes that change escrow state are wired to notify', () => {
  // Guards the call sites: a template nothing sends is dead weight, and this
  // is the cheapest way to notice a route losing its notification in a merge.
  const fs = require('node:fs');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const expected = [
    ['lib/seller-routes.js', ['notify.orderDelivered', 'notify.disputeOpened', 'notify.escrowReleased', 'notify.withdrawalRequested']],
    ['lib/admin-routes.js', ['notify.sellerApproved', 'notify.sellerRejected', 'notify.withdrawalPaid', 'notify.withdrawalRejected', 'notify.escrowResolved']],
    ['lib/payment-routes.js', ['notify.paymentInstructions', 'notify.walletToppedUp']],
    ['server.js', ['notify.welcome', 'notify.sellerApproved']],
  ];
  for (const [file, calls] of expected) {
    const src = read(file);
    for (const call of calls) assert.ok(src.includes(call), `${file} calls ${call}`);
  }
});

test('the release path can address its notification', () => {
  // resolveEscrow returns { released, payout } with NO escrow — only its
  // refund path carries one — so the admin route has to read the deal itself
  // or every "found for the seller" decision would silently email nobody.
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'lib', 'admin-routes.js'), 'utf8');
  const route = src.slice(src.indexOf("app.post('/api/admin/disputes/:dealId/resolve'"));
  const body = route.slice(0, route.indexOf('app.get('));
  assert.ok(/getEscrow\(req\.params\.dealId\)/.test(body), 'it reads the escrow before resolving');
  assert.ok(/escrow: result\.escrow \|\| escrow/.test(body), 'and falls back to it on the release path');
});
