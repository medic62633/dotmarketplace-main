/* Email templates are the one output nobody sees fail: a broken one still
 * "sends", and the damage — an unescaped listing title, a literal &rsquo;, a
 * receipt billing the buyer for the seller's fee — only surfaces in someone's
 * inbox. These pin the properties that hold for every template.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/email-templates');

const now = new Date('2026-09-04T18:20:00Z');

/* One realistic invocation of every exported template, so the sweeps below
 * cover the whole set rather than a hand-picked few. Kept in step with the
 * exports by the "every template is exercised" test at the bottom. */
const ALL = {
  verificationEmail: { name: 'Alex', code: '481902', minutes: 10, requestedAt: now },
  welcomeEmail: 'Alex',
  sellerApprovedEmail: { name: 'Sam', email: 'sam@example.com' },
  sellerRejectedEmail: { name: 'Sam', email: 'sam@example.com', reason: 'Repeated non-delivery' },
  paymentInstructionsEmail: {
    title: 'Item', orderId: 'DK-1', address: 'TQm123', amount: 24.985411, decimals: 6,
    ticker: 'USDT', networkLabel: 'TRON (TRC-20)', amountUsd: 24.99, confirmMinutes: 3, expiresAt: now,
  },
  paymentConfirmedEmail: {
    title: 'Item', orderId: 'DK-1', listingAmount: 24.99, gatewayFee: 0.5, buyerTotal: 25.49,
    paidAt: now, networkLabel: 'TRON (TRC-20)', txHash: 'abc123',
  },
  credentialEmail: { title: 'Item', orderId: 'DK-1', credential: 'user:pass', deliveredAt: now },
  orderDeliveredEmail: { title: 'Item', orderId: 'DK-1', amount: 24.99, deliveredAt: now, proof: 'sent', sellerName: 'Sam' },
  escrowReleasedBuyerEmail: { title: 'Item', orderId: 'DK-1', amount: 24.99, releasedAt: now, sellerName: 'Sam' },
  refundEmail: { title: 'Item', orderId: 'DK-1', amount: 24.99, refundedAt: now, reason: 'not delivered' },
  disputeOpenedEmail: { title: 'Item', orderId: 'DK-1', amount: 24.99, openedAt: now, reason: 'broken', audience: 'seller' },
  disputeResolvedEmail: { title: 'Item', orderId: 'DK-1', amount: 24.99, outcome: 'refunded', resolvedAt: now, audience: 'buyer' },
  sellerSaleEmail: { title: 'Item', orderId: 'DK-1', amount: 24.99, paidAt: now, buyerName: 'Alex', platformFee: 0.62, sellerNet: 24.37 },
  payoutReleasedEmail: { title: 'Item', orderId: 'DK-1', gross: 24.99, fee: 0.62, net: 24.37, releasedAt: now, balance: 100 },
  withdrawalRequestedEmail: { amount: 500, address: 'TQm123', networkLabel: 'USDT TRC-20', requestedAt: now, reference: 'WD-1', balance: 784.5 },
  withdrawalPaidEmail: { amount: 500, address: 'TQm123', networkLabel: 'USDT TRC-20', txHash: 'h', paidAt: now, reference: 'WD-1' },
  withdrawalRejectedEmail: { amount: 500, reason: 'bad address', rejectedAt: now, reference: 'WD-1', balance: 1284.5 },
  walletToppedUpEmail: { amount: 100, balance: 124.99, networkLabel: 'USDT TRC-20', txHash: 'h', creditedAt: now, orderId: 'TOPUP-1' },
};

const render = (name) => t[name](ALL[name]);
const names = Object.keys(ALL);

test('every template returns a subject, an HTML part and a text part', () => {
  for (const name of names) {
    const m = render(name);
    assert.ok(m.subject && m.subject.length > 5, `${name} has a subject`);
    assert.ok(!/\n/.test(m.subject), `${name} subject is a single line`);
    assert.ok(m.html.startsWith('<!doctype html>'), `${name} is a full document`);
    assert.ok(m.text && m.text.length > 80, `${name} has a real text part`);
  }
});

test('no template leaks an unrendered HTML entity into the rendered page', () => {
  // esc() escapes the '&' of an entity written inside an escaped slot, so
  // `&rsquo;` in an h1 or a monoBox label reaches the reader as literal text.
  // Two templates shipped exactly that before this test existed.
  for (const name of names) {
    const m = render(name);
    const doubled = [...m.html.matchAll(/&amp;(#?[a-zA-Z0-9]{2,8});/g)].map(x => x[0]);
    assert.deepEqual(doubled, [], `${name} renders no literal entity: ${doubled.join(' ')}`);
  }
});

test('the plain-text part is plain text — no tags, no entities', () => {
  for (const name of names) {
    const m = render(name);
    assert.ok(!/<[a-z/][^>]*>/i.test(m.text), `${name} text part carries no markup`);
    const ents = [...m.text.matchAll(/&(#?[a-zA-Z0-9]{2,8});/g)].map(x => x[0]);
    assert.deepEqual(ents, [], `${name} text part carries no entities: ${ents.join(' ')}`);
  }
});

test('caller-supplied values are escaped into the HTML', () => {
  const attack = `</td></tr></table><script>alert(1)</script>"onmouseover="x`;
  // Every field a template renders that an attacker could influence: a listing
  // title, a dispute reason, a delivery note, a name, a credential.
  const cases = [
    t.paymentConfirmedEmail({ title: attack, orderId: attack, listingAmount: 1, paidAt: now }),
    t.credentialEmail({ title: attack, orderId: 'o', credential: attack, deliveredAt: now }),
    t.orderDeliveredEmail({ title: 'x', orderId: 'o', amount: 1, proof: attack, sellerName: attack, deliveredAt: now }),
    t.disputeOpenedEmail({ title: 'x', orderId: 'o', amount: 1, reason: attack, openedAt: now }),
    t.sellerSaleEmail({ title: attack, orderId: 'o', amount: 1, buyerName: attack, paidAt: now }),
    t.sellerRejectedEmail({ email: 'a@b.c', name: attack, reason: attack }),
    t.paymentInstructionsEmail({ title: attack, orderId: 'o', address: attack, amount: 1, decimals: 2, ticker: 'USDT' }),
  ];
  for (const m of cases) {
    assert.ok(!m.html.includes(attack), 'the payload never appears verbatim');
    assert.ok(!m.html.includes('<script>'), 'no injected script tag survives');
    assert.ok(!m.html.includes('"onmouseover="'), 'no injected attribute survives');
    assert.ok(m.html.includes('&lt;script&gt;'), 'the payload is present, escaped');
  }
});

test('a multi-line credential keeps its line breaks', () => {
  // Sellers stock credentials as "login: …\npassword: …\nprofile: …". HTML
  // collapses those newlines, which ran the whole block together as one
  // wrapped paragraph — exactly the text a buyer has to copy accurately.
  const credential = 'login: sam@example.com\npassword: Kf7!tqR2#vLm\nprofile: slot 3';
  const m = t.credentialEmail({ title: 'x', orderId: 'o', credential, deliveredAt: now });
  assert.ok(m.html.includes('password: Kf7!tqR2#vLm<br>'), 'each line is broken in the HTML');
  assert.equal((m.html.match(/<br>/g) || []).length >= 2, true, 'both breaks survive');
  assert.ok(m.text.includes(credential), 'and the text part carries it verbatim');

  // The break substitution must not become an escaping hole.
  const nasty = 'a\n<script>alert(1)</script>\nb';
  const bad = t.credentialEmail({ title: 'x', orderId: 'o', credential: nasty, deliveredAt: now });
  assert.ok(!bad.html.includes('<script>'), 'still escaped');
  assert.ok(bad.html.includes('&lt;script&gt;'));
});

test('a buyer receipt never bills the buyer for the seller\'s platform fee', () => {
  // lib/fees.js: platformFee is deducted from sellerNet — the buyer never pays
  // it — while gatewayFee is added on top of the listing price and IS theirs.
  const m = t.paymentConfirmedEmail({
    title: 'Item', orderId: 'DK-1', listingAmount: 24.99, gatewayFee: 0.5, buyerTotal: 25.49, paidAt: now,
  });
  assert.ok(!/Platform fee/i.test(m.html), 'the platform fee is not on the buyer receipt');
  assert.ok(!/Platform fee/i.test(m.text));
  assert.ok(m.html.includes('25.49 USDT'), 'the total the buyer actually paid is shown');
  assert.ok(m.html.includes('24.99 USDT'), 'and the item price it came from');

  // The seller's own emails DO show it, because it is their cost.
  const sale = t.sellerSaleEmail({ title: 'Item', orderId: 'DK-1', amount: 24.99, platformFee: 0.62, sellerNet: 24.37, paidAt: now });
  assert.ok(/Platform fee/i.test(sale.html), 'the seller is shown the fee they pay');
  assert.ok(sale.html.includes('24.37 USDT'), 'and the net they receive');
});

test('money is rendered at two decimals, and a missing amount is never shown as 0.00', () => {
  const m = t.payoutReleasedEmail({ title: 'x', orderId: 'o', gross: 12.5, fee: 0.3, net: 12.2, releasedAt: now });
  assert.ok(m.html.includes('12.50 USDT'), 'a whole-cent amount keeps both decimals');
  // An absent figure must read as unknown rather than as zero money.
  const missing = t.refundEmail({ title: 'x', orderId: 'o', amount: null, refundedAt: now });
  assert.ok(!/0\.00 USDT/.test(missing.html), 'an absent amount is not invented as 0.00');
});

test('a coin amount keeps the precision it was quoted at', () => {
  // Truncating a 6-decimal USDT-TRC20 invoice to 2dp would tell the buyer to
  // send the wrong number, and an underpayment is not credited.
  const m = t.paymentInstructionsEmail({
    title: 'x', orderId: 'o', address: 'TQm', amount: 24.985411, decimals: 6, ticker: 'USDT', networkLabel: 'TRON (TRC-20)',
  });
  assert.ok(m.html.includes('24.985411 USDT'), 'the full quoted precision is shown');
  assert.ok(m.text.includes('24.985411 USDT'), 'in the text part too');
  assert.ok(!m.html.includes('24.99 USDT'), 'and never rounded to a payable-looking lie');
});

test('the payment-instructions email carries the address, the network and the irreversibility warning', () => {
  const m = t.paymentInstructionsEmail({
    title: 'x', orderId: 'o', address: 'TQmVsW9d8kPzn4YbR7uJ3xLpKc2FhNvGqA',
    amount: 1, decimals: 6, ticker: 'USDT', networkLabel: 'TRON (TRC-20)',
  });
  for (const part of [m.html, m.text]) {
    assert.ok(part.includes('TQmVsW9d8kPzn4YbR7uJ3xLpKc2FhNvGqA'), 'the address is present');
    assert.ok(part.includes('TRON (TRC-20)'), 'the network is named');
    assert.ok(/cannot be reversed/i.test(part), 'and the warning that it cannot be undone');
  }
});

test('every link points at a route the app actually serves', () => {
  // The previous templates linked every order button at `/?order=<id>`, a query
  // string nothing in public/js/app.js reads — so they all landed on the
  // homepage. These are the real hash routes (VIEWS / parseHashView in app.js).
  const served = new Set(['', '#deals', '#messages', '#wallet', '#legal/terms', '#legal/privacy', '#legal/refund']);
  const base = t._internals.BASE_URL;
  for (const name of names) {
    const m = render(name);
    for (const href of [...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1])) {
      if (href === base) continue;                       // the footer's brand link
      if (href.startsWith(base + '/seller/')) continue;  // the seller portal is a real page
      assert.ok(href.startsWith(base + '/'), `${name}: ${href} is absolute`);
      const rest = href.slice(base.length + 1);
      assert.ok(served.has(rest), `${name}: ${href} is a route the app serves`);
    }
  }
});

test('dispute mail is worded for the side it is addressed to', () => {
  const args = { title: 'x', orderId: 'o', amount: 10, openedAt: now, reason: 'no delivery' };
  const seller = t.disputeOpenedEmail({ ...args, audience: 'seller' });
  const buyer = t.disputeOpenedEmail({ ...args, audience: 'buyer' });
  assert.notEqual(seller.subject, buyer.subject, 'the two sides get different subjects');
  assert.ok(/What the buyer reported/.test(seller.html), 'the seller is shown it as the buyer\'s claim');
  assert.ok(/What you reported/.test(buyer.html), 'the buyer is shown it as their own');

  const refunded = t.disputeResolvedEmail({ ...args, outcome: 'refunded', audience: 'buyer' });
  const released = t.disputeResolvedEmail({ ...args, outcome: 'released', audience: 'buyer' });
  assert.ok(/REFUNDED TO THE BUYER/.test(refunded.text));
  assert.ok(/RELEASED TO THE SELLER/.test(released.text));
});

test('no block declares a width that a phone cannot honour', () => {
  // Two templates scrolled sideways on a 360px screen because summary()'s key
  // cells were white-space:nowrap — an unwrappable cell puts a floor under the
  // table's min-content width, and that table is the widest block in most of
  // these emails, so its floor became the whole message's.
  //
  // Rendering is checked in a real browser by scripts/preview-emails.js; this
  // guards the specific declaration that caused it, which is what would come
  // back in an edit.
  // A short status pill may keep nowrap — it is bounded and cannot set the
  // floor. A table CELL cannot: its content is caller-supplied and unbounded.
  for (const name of names) {
    const m = render(name);
    const nowrapCells = [...m.html.matchAll(/<td[^>]*white-space:\s*nowrap[^>]*>/g)];
    assert.equal(nowrapCells.length, 0, `${name} has no unwrappable table cell`);
    // Fixed pixel widths wider than the mobile card are the other way in.
    const widths = [...m.html.matchAll(/(?:^|[^-])width:\s*(\d{3,})px/g)].map(x => Number(x[1]));
    for (const w of widths) {
      assert.ok(w <= 600, `${name} declares no width above the 600px shell (${w}px)`);
    }
  }
});

test('every exported template is exercised above', () => {
  // Stops a template being added with no coverage at all: the sweeps in this
  // file are only as complete as ALL.
  const exported = Object.keys(t).filter(k => k.endsWith('Email'));
  assert.deepEqual(exported.sort(), names.slice().sort(), 'ALL covers exactly the exported templates');
});
