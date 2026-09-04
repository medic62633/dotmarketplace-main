#!/usr/bin/env node
/* Renders every transactional template to ./email-preview/ with realistic
 * sample data, plus an index page, so the whole set can be eyeballed in a
 * browser without sending a single message.
 *
 *   node scripts/preview-emails.js [outDir]
 *
 * The .txt sibling of each file is the plain-text part the same template
 * produced — worth reading too, since that is what a text-only client shows.
 */
const fs = require('node:fs');
const path = require('node:path');
const t = require('../lib/email-templates');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'email-preview'));

const now = new Date('2026-09-04T18:20:00Z');
const earlier = new Date('2026-09-04T17:05:00Z');

/* Deliberately awkward sample data: an apostrophe and angle brackets in the
 * listing title prove the escaping holds in a rendered page, not just a test. */
const ITEM = "Netflix Premium <4K> — Sam's stock";

const CASES = [
  ['verification', 'Email verification code', () => t.verificationEmail({ name: 'Alex', code: '481902', minutes: 10, requestedAt: now })],
  ['welcome', 'Welcome / onboarding', () => t.welcomeEmail('Alex')],
  ['payment-instructions', 'Crypto payment instructions', () => t.paymentInstructionsEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', address: 'TQmVsW9d8kPzn4YbR7uJ3xLpKc2FhNvGqA',
    amount: 24.985411, decimals: 6, ticker: 'USDT', networkLabel: 'TRON (TRC-20)',
    amountUsd: 24.99, confirmMinutes: 3, expiresAt: new Date('2026-09-04T19:20:00Z'),
  })],
  ['payment-confirmed', 'Payment confirmed (buyer)', () => t.paymentConfirmedEmail({
    title: ITEM, amount: 24.99, buyerTotal: 24.99, orderId: 'DK-9f2a7c41b0d3e58a', paidAt: now,
    networkLabel: 'TRON (TRC-20)', txHash: '9c1f0a7b3e5d2846af90bb17c4e6d3520718aa9fce4b1d06', platformFee: 0.62,
  })],
  ['credential', 'Auto-delivered credentials', () => t.credentialEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', deliveredAt: now,
    credential: 'login: sam.delivery+premium@example.com\npassword: Kf7!tqR2#vLm\nprofile: slot 3 — do not rename',
  })],
  ['order-delivered', 'Seller marked delivered', () => t.orderDeliveredEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, deliveredAt: now,
    sellerName: 'PixelVault', proof: 'Sent the login in the deal chat at 18:19 UTC — profile 3 is yours.',
  })],
  ['escrow-released-buyer', 'Order complete (buyer)', () => t.escrowReleasedBuyerEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, releasedAt: now, sellerName: 'PixelVault',
  })],
  ['refund', 'Refund issued', () => t.refundEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, refundedAt: now,
    reason: 'Seller could not deliver within the agreed window',
  })],
  ['dispute-opened-buyer', 'Dispute opened (buyer copy)', () => t.disputeOpenedEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, openedAt: now, audience: 'buyer',
    reason: 'The password was already changed when I tried it, and profile 3 does not exist on the account.',
  })],
  ['dispute-opened-seller', 'Dispute opened (seller copy)', () => t.disputeOpenedEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, openedAt: now, audience: 'seller',
    reason: 'The password was already changed when I tried it, and profile 3 does not exist on the account.',
  })],
  ['dispute-resolved-refund', 'Dispute resolved — refunded', () => t.disputeResolvedEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, outcome: 'refunded', resolvedAt: now,
    audience: 'buyer', note: 'Deal chat shows no working credential was ever delivered.',
  })],
  ['dispute-resolved-release', 'Dispute resolved — released', () => t.disputeResolvedEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, outcome: 'released', resolvedAt: now,
    audience: 'seller', note: 'Credential was delivered and used before the dispute was opened.',
  })],
  ['seller-sale', 'New sale (seller)', () => t.sellerSaleEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', amount: 24.99, paidAt: now,
    buyerName: 'Alex', platformFee: 0.62, sellerNet: 24.37,
  })],
  ['payout-released', 'Payout released (seller)', () => t.payoutReleasedEmail({
    title: ITEM, orderId: 'DK-9f2a7c41b0d3e58a', gross: 24.99, fee: 0.62, net: 24.37,
    releasedAt: now, balance: 1284.5,
  })],
  ['seller-approved', 'Seller verified', () => t.sellerApprovedEmail({ name: 'Sam', email: 'sam@example.com' })],
  ['seller-rejected', 'Seller access withdrawn', () => t.sellerRejectedEmail({
    name: 'Sam', email: 'sam@example.com', reason: 'Repeated non-delivery across three disputed orders.',
  })],
  ['withdrawal-requested', 'Withdrawal requested', () => t.withdrawalRequestedEmail({
    amount: 500, address: 'TQmVsW9d8kPzn4YbR7uJ3xLpKc2FhNvGqA', networkLabel: 'TRON (TRC-20)',
    requestedAt: earlier, reference: 'WD-4471', balance: 784.5,
  })],
  ['withdrawal-paid', 'Withdrawal sent', () => t.withdrawalPaidEmail({
    amount: 500, address: 'TQmVsW9d8kPzn4YbR7uJ3xLpKc2FhNvGqA', networkLabel: 'TRON (TRC-20)',
    txHash: '4b7e19c0aa3f5d2861b90c47ef6d3521708aa9fce4b1d0629c1f0a7b3e5d2846', paidAt: now, reference: 'WD-4471',
  })],
  ['withdrawal-rejected', 'Withdrawal rejected', () => t.withdrawalRejectedEmail({
    amount: 500, rejectedAt: now, reference: 'WD-4471', balance: 1284.5,
    reason: 'Destination address is an ERC-20 address, but the payout network is TRC-20',
  })],
  ['wallet-topup', 'Wallet topped up', () => t.walletToppedUpEmail({
    amount: 100, balance: 124.99, networkLabel: 'TRON (TRC-20)', creditedAt: now,
    txHash: '9c1f0a7b3e5d2846af90bb17c4e6d3520718aa9fce4b1d06', orderId: 'TOPUP-7c31a8',
  })],
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const rendered = CASES.map(([slug, label, make]) => {
  const mail = make();
  fs.writeFileSync(path.join(outDir, slug + '.html'), mail.html);
  fs.writeFileSync(path.join(outDir, slug + '.txt'), `Subject: ${mail.subject}\n\n${mail.text}\n`);
  return { slug, label, subject: mail.subject, bytes: Buffer.byteLength(mail.html) };
});

const rows = rendered.map(r => `<tr>
  <td><a href="./${r.slug}.html">${r.label}</a></td>
  <td class="subj">${r.subject.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</td>
  <td class="n">${(r.bytes / 1024).toFixed(1)} KB</td>
  <td><a href="./${r.slug}.txt">text</a></td>
</tr>`).join('\n');

fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8">
<title>Dot Marketplace — email previews</title>
<style>
 body{background:#08080f;color:#f4f4f8;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:40px 24px}
 .w{max-width:940px;margin:0 auto}h1{font-size:24px;letter-spacing:-.5px;margin:0 0 6px}
 p.sub{color:#82828f;margin:0 0 26px}
 table{width:100%;border-collapse:collapse;background:#12121d;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden}
 td,th{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}
 th{color:#82828f;font-size:12px;text-transform:uppercase;letter-spacing:1px}
 tr:last-child td{border-bottom:0}
 a{color:#ffc800;text-decoration:none}a:hover{text-decoration:underline}
 .subj{color:#b8b8c6;font-size:13px}.n{color:#82828f;font-size:13px;white-space:nowrap}
</style>
<div class="w"><h1>Transactional email previews</h1>
<p class="sub">${rendered.length} templates · generated ${new Date().toISOString()} · sample data only</p>
<table><tr><th>Template</th><th>Subject line</th><th>Size</th><th>Plain text</th></tr>
${rows}
</table></div>`);

console.log(`Rendered ${rendered.length} templates → ${outDir}`);
console.log(`Open ${path.join(outDir, 'index.html')}`);
