/* Transactional email templates for Dot Marketplace.
 *
 * Built for broad client support (Gmail, Outlook, Apple Mail, mobile):
 * table-based layout, fully inline CSS, no remote images, no external fonts.
 * Every template returns { html, text } so plain-text clients get a clean body.
 *
 * Provider-agnostic — Resend (or any SMTP relay) just sends whatever
 * { html, text } we hand it. Brand constants are at the top for easy tweaks.
 * Optional fields (name, orderUrl) degrade gracefully so callers can pass only
 * what they have.
 */

const BRAND = 'Dot Marketplace';
const TAGLINE = 'Escrow-protected digital goods';
const BASE_URL = process.env.PUBLIC_URL || 'https://dot.market';
const COLOR = {
  bg: '#f2f4f8',
  card: '#ffffff',
  ink: '#0f1222',
  sub: '#3d4152',
  muted: '#6b7280',
  faint: '#9aa0ae',
  accent: '#6d5ef0',
  accentDark: '#5847e0',
  border: '#e6e8ef',
  good: '#0e9f6e',
  goodBg: '#e9f9f1',
  codeBg: '#f3f1ff',
  warnBg: '#fff7ed',
  warnBorder: '#fed7aa',
  warnInk: '#9a3412',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Shared shell: preheader (inbox preview), brand bar, centered card, footer. */
function shell({ title, preheader, bodyHtml, bodyText }) {
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${COLOR.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader || title)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
      <tr><td style="padding:0 4px 20px;text-align:center;">
        <span style="display:inline-block;width:36px;height:36px;border-radius:10px;background:${COLOR.accent};color:#fff;font:bold 18px/36px system-ui,Arial;text-align:center;vertical-align:middle;">&#9679;</span>
        <span style="display:inline-block;vertical-align:middle;margin-left:9px;text-align:left;">
          <span style="display:block;font:700 17px/1.1 system-ui,Arial,sans-serif;color:${COLOR.ink};letter-spacing:-.2px;">${esc(BRAND)}</span>
          <span style="display:block;font:12px/1.2 system-ui,Arial,sans-serif;color:${COLOR.muted};">${esc(TAGLINE)}</span>
        </span>
      </td></tr>
      <tr><td style="background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:16px;padding:34px 34px 28px;font:15px/1.65 system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:${COLOR.sub};">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:22px 14px;text-align:center;font:12px/1.7 system-ui,Arial,sans-serif;color:${COLOR.muted};">
        Need help? Open the deal chat on your orders page, or reply to your order confirmation.<br>
        <span style="color:${COLOR.faint};">${esc(BRAND)} &middot; ${esc(TAGLINE)}<br>This is an automated transactional message about your account.</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { html, text: `${title}\n${'='.repeat(Math.min(title.length, 40))}\n\n${bodyText}\n\n— ${BRAND}\n${BASE_URL}` };
}

/* ---- building blocks ---- */
function h1(s) {
  return `<h1 style="margin:0 0 8px;font:700 22px/1.25 system-ui,Arial,sans-serif;color:${COLOR.ink};letter-spacing:-.3px;">${esc(s)}</h1>`;
}
function lead(html) {
  return `<p style="margin:0 0 18px;font-size:15px;color:${COLOR.sub};">${html}</p>`;
}
function p(html) {
  return `<p style="margin:0 0 14px;">${html}</p>`;
}
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;"><tr><td style="border-radius:10px;background:${COLOR.accent};">
    <a href="${esc(href)}" style="display:inline-block;padding:13px 30px;font:700 15px system-ui,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px;background:${COLOR.accent};">${esc(label)}</a>
  </td></tr></table>
  <p style="margin:0 0 14px;font-size:12px;color:${COLOR.muted};">Or paste this link: <span style="font-family:Consolas,monospace;color:${COLOR.accentDark};word-break:break-all;">${esc(href)}</span></p>`;
}
function bigCode(code) {
  return `<div style="margin:20px 0;padding:22px;text-align:center;background:${COLOR.codeBg};border:1px solid ${COLOR.border};border-radius:14px;">
    <span style="font:700 36px/1 'SFMono-Regular',Consolas,monospace;letter-spacing:11px;color:${COLOR.accentDark};">${esc(code)}</span>
  </div>`;
}
function monoBox(content) {
  return `<div style="margin:16px 0;padding:16px 18px;background:#f7f7f9;border:1px solid ${COLOR.border};border-radius:12px;font:14px/1.7 'SFMono-Regular',Consolas,monospace;word-break:break-all;color:${COLOR.ink};">${esc(content)}</div>`;
}
function amountPill(amount) {
  return `<span style="display:inline-block;padding:3px 12px;border-radius:999px;background:${COLOR.goodBg};color:${COLOR.good};font-weight:700;">${esc(amount)} USDT</span>`;
}
/* Two-column order summary table. */
function summary(rows) {
  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:9px 0;font-size:13px;color:${COLOR.muted};vertical-align:top;">${esc(k)}</td>
     <td style="padding:9px 0;font-size:14px;color:${COLOR.ink};text-align:right;vertical-align:top;font-weight:600;">${v}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-top:1px solid ${COLOR.border};border-bottom:1px solid ${COLOR.border};">${trs}</table>`;
}
function divider() {
  return `<div style="height:1px;background:${COLOR.border};margin:20px 0;"></div>`;
}
function note(innerHtml, { tone = 'warn' } = {}) {
  const bg = tone === 'warn' ? COLOR.warnBg : COLOR.codeBg;
  const bd = tone === 'warn' ? COLOR.warnBorder : COLOR.border;
  const ink = tone === 'warn' ? COLOR.warnInk : COLOR.sub;
  return `<div style="margin:18px 0;padding:13px 16px;background:${bg};border:1px solid ${bd};border-radius:10px;font-size:13px;color:${ink};">${innerHtml}</div>`;
}
function steps(items) {
  const lis = items.map(i => `<li style="margin:0 0 8px;">${i}</li>`).join('');
  return `<ol style="margin:8px 0 16px;padding-left:20px;">${lis}</ol>`;
}
function orderUrl(orderId) {
  return `${BASE_URL}/?order=${encodeURIComponent(orderId)}`;
}

/* Emails render dates in UTC with a fixed locale — the server-local timezone/
 * locale would otherwise make a receipt's timestamp differ from what the buyer
 * sees in-app for the same event. */
function utcDate(d) {
  const dt = d ? new Date(d) : new Date();
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

/* ---------- templates ---------- */

function verificationEmail({ name, code, minutes }) {
  return shell({
    title: 'Confirm your email address',
    preheader: `${code} is your ${BRAND} verification code — valid for ${minutes} minutes.`,
    bodyHtml:
      h1('Confirm your email') +
      lead(`Hi ${esc(name)}, welcome to ${esc(BRAND)}. Enter the code below to verify this email address and secure your account.`) +
      bigCode(code) +
      summary([
        ['Code', `<span style="font-family:Consolas,monospace;">${esc(code)}</span>`],
        ['Expires in', esc(`${minutes} minutes`)],
        ['Requested for', esc(BRAND) + ' signup'],
      ]) +
      note(`<b>Didn&rsquo;t request this?</b> If you didn&rsquo;t create a ${esc(BRAND)} account, you can safely ignore this email — no account will be verified.`),
    bodyText:
      `Hi ${name},\n\nWelcome to ${BRAND}. Enter this code to verify your email address:\n\n  ${code}\n\nExpires in: ${minutes} minutes\n\nDidn't request this? If you didn't create a ${BRAND} account, ignore this email — no account will be verified.`,
  });
}

function welcomeEmail(name) {
  return shell({
    title: `Welcome to ${BRAND}`,
    preheader: 'Your account is ready — every deal is protected by escrow.',
    bodyHtml:
      h1(`Welcome, ${esc(name)}`) +
      lead(`Your ${esc(BRAND)} account is all set. Here&rsquo;s how buying and selling stay safe on every order:`) +
      steps([
        `<b>Pay into escrow</b> — your funds are locked, not sent to the seller.`,
        `<b>Seller delivers</b> — digital goods arrive by auto-delivery or deal chat.`,
        `<b>You confirm</b> — only then is the payment released to the seller.`,
      ]) +
      p('Selling? Stock credentials on a listing and we&rsquo;ll auto-deliver them the moment a buyer pays.') +
      button(`${BASE_URL}/`, 'Start browsing'),
    bodyText:
      `Hi ${name},\n\nYour ${BRAND} account is all set. How every order stays safe:\n\n1. Pay into escrow — funds are locked, not sent to the seller.\n2. Seller delivers — by auto-delivery or deal chat.\n3. You confirm — only then is payment released.\n\nSelling? Stock credentials on a listing and we auto-deliver on payment.\n\nStart browsing: ${BASE_URL}/`,
  });
}

function sellerSaleEmail({ title, amount, orderId, orderUrl: url }) {
  const link = url || orderUrl(orderId);
  return shell({
    title: 'You made a sale',
    preheader: `${title} sold for ${amount} USDT — funds are held in escrow.`,
    bodyHtml:
      h1('You made a sale') +
      lead(`Good news &mdash; a buyer just paid for your item. The funds are locked in escrow and will be released once delivery is confirmed.`) +
      summary([
        ['Item', esc(title)],
        ['Sale amount', amountPill(amount)],
        ['Order', `<span style="font-family:Consolas,monospace;">${esc(orderId)}</span>`],
        ['Status', 'Paid &middot; in escrow'],
      ]) +
      p('Next steps:') +
      steps([
        'Deliver the goods via the deal chat (or they auto-deliver if stocked).',
        'Mark the order <b>delivered</b> in your seller portal.',
        'Once the buyer confirms, the payout is released to your balance.',
      ]) +
      button(link, 'Open order'),
    bodyText:
      `You made a sale\n\nItem: ${title}\nAmount: ${amount} USDT\nOrder: ${orderId}\nStatus: Paid, in escrow\n\nNext steps:\n1. Deliver via the deal chat (or auto-delivered if stocked).\n2. Mark the order delivered in your seller portal.\n3. Payout is released once the buyer confirms.\n\nOpen order: ${link}`,
  });
}

function paymentConfirmedEmail({ title, amount, orderId, orderUrl: url, paidAt }) {
  const link = url || orderUrl(orderId);
  return shell({
    title: 'Payment confirmed',
    preheader: `${title} — ${amount} USDT confirmed and held safely in escrow.`,
    bodyHtml:
      h1('Payment confirmed') +
      lead(`Thanks &mdash; your payment went through and is now held securely in escrow. The seller is only paid after you confirm delivery.`) +
      summary([
        ['Item', esc(title)],
        ['Amount paid', amountPill(amount)],
        ['Order', `<span style="font-family:Consolas,monospace;">${esc(orderId)}</span>`],
        ['Confirmed', esc(utcDate(paidAt))],
        ['Status', 'Confirmed &middot; in escrow'],
      ]) +
      p('What happens next:') +
      steps([
        'Your item is delivered by auto-delivery or the deal chat.',
        'Check everything works.',
        'Confirm delivery to release the payment to the seller.',
      ]) +
      button(link, 'View your order') +
      note(`<b>Your money is protected.</b> If the item isn&rsquo;t delivered or doesn&rsquo;t match the listing, open a dispute from the deal page before confirming &mdash; the escrow holds your funds.`),
    bodyText:
      `Payment confirmed\n\nItem: ${title}\nAmount: ${amount} USDT\nOrder: ${orderId}\nStatus: Confirmed, in escrow\n\nWhat happens next:\n1. Your item is delivered (auto-delivery or deal chat).\n2. Check everything works.\n3. Confirm delivery to release payment.\n\nView your order: ${link}\n\nYour money is protected: if the item isn't delivered or doesn't match, open a dispute before confirming.`,
  });
}

function credentialEmail({ title, orderId, credential, orderUrl: url }) {
  const link = url || orderUrl(orderId);
  return shell({
    title: 'Your delivery is here',
    preheader: `Your credentials for ${title} are ready.`,
    bodyHtml:
      h1('Your delivery is here') +
      lead(`Your order for <b>${esc(title)}</b> has been delivered. Here are your credentials:`) +
      monoBox(credential) +
      summary([
        ['Item', esc(title)],
        ['Order', `<span style="font-family:Consolas,monospace;">${esc(orderId)}</span>`],
        ['Delivery', 'Auto-delivered'],
      ]) +
      note(`<b>Keep these private.</b> Anyone with these credentials can use the account. Don&rsquo;t share them, and consider changing the password after first login if the listing allows.`) +
      p('Something not working? Open the deal chat from your orders page and we&rsquo;ll sort it out.') +
      button(link, 'Open your order'),
    bodyText:
      `Your delivery is here\n\nYour order for ${title} has been delivered. Credentials:\n\n${credential}\n\nItem: ${title}\nOrder: ${orderId}\nDelivery: Auto-delivered\n\nKeep these private — anyone with them can use the account. Something not working? Open the deal chat.\n\nOpen your order: ${link}`,
  });
}

module.exports = { welcomeEmail, sellerSaleEmail, paymentConfirmedEmail, credentialEmail, verificationEmail };
