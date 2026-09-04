/* Transactional email templates for Dot Marketplace.
 *
 * DESIGN — these mirror the product's own identity: deep-ink chrome with the
 * amber brand (public/theme.css: --bg #090911, --brand #ffc800, --brand-ink
 * #17130a), so an email reads as the same thing the buyer just used. The
 * content itself sits on a white card: a dark card would be at the mercy of
 * every client's dark-mode "colour inversion" heuristics, and an inverted dark
 * card is unreadable, whereas dark-on-light survives inversion either way.
 *
 * CLIENT SUPPORT — table layout, every style inline, no remote images, no web
 * fonts, no CSS the Word rendering engine (Outlook 2016-2021 desktop) chokes
 * on. Buttons carry a VML fallback so Outlook draws the real pill rather than
 * shrink-wrapping the label, and every coloured surface sets the `bgcolor`
 * attribute alongside the CSS so Word-engine clients still paint it.
 *
 * EVERY template returns { subject, html, text }: the subject line is part of
 * the template, not something each call site invents, so tone stays consistent
 * and a plain-text client still gets a properly composed body.
 *
 * Optional fields degrade — pass what you have. Callers hand these straight to
 * lib/mailer.js, which is provider-agnostic (ACS, SES, Resend, any SMTP relay).
 */

const BRAND = 'Dot Marketplace';
const TAGLINE = 'Escrow-protected digital goods';
const BASE_URL = (process.env.PUBLIC_URL || 'https://dot.market').replace(/\/+$/, '');

const COLOR = {
  /* chrome — the site's deep ink */
  page: '#08080f',
  chrome: '#0e0e18',
  chromeInk: '#ffffff',
  chromeMuted: '#8b8b99',
  chromeLine: '#22222f',

  /* card */
  card: '#ffffff',
  border: '#e6e8f0',
  borderSoft: '#f0f1f6',
  ink: '#0f1116',
  sub: '#3a3f4b',
  muted: '#6b7280',
  faint: '#9aa0ae',

  /* brand */
  brand: '#ffc800',
  brandInk: '#17130a',
  brandDeep: '#7a5c00',
  brandWash: '#fff8e0',
  brandLine: '#ffe89a',

  /* status */
  good: '#0e7d5a',
  goodWash: '#e8f7f1',
  goodLine: '#bfe8d8',
  warn: '#8a5a00',
  warnWash: '#fff5e0',
  warnLine: '#ffdf9e',
  danger: '#b3261e',
  dangerWash: '#fdeceb',
  dangerLine: '#f6cdca',
  info: '#33405c',
  infoWash: '#eef1f8',
  infoLine: '#d7dcea',

  wash: '#f7f8fb',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',ui-monospace,Menlo,Consolas,'Liberation Mono',monospace";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- links ----------
 * Only routes the app actually serves. The previous templates pointed every
 * order button at `/?order=<id>`, a query string nothing in public/js/app.js
 * reads — so every "View your order" landed on the homepage. These use the
 * real hash routes (see parseHashView / VIEWS in app.js). */
const appUrl = (hash = '') => BASE_URL + '/' + (hash ? '#' + hash : '');
const ordersUrl = () => appUrl('deals');
const walletUrl = () => appUrl('wallet');
const messagesUrl = () => appUrl('messages');
const legalUrl = (doc) => appUrl('legal/' + doc);
const sellerPortalUrl = () => BASE_URL + '/seller/';

/* Emails render dates in UTC with a fixed locale — the server's local timezone
 * would otherwise make a receipt's timestamp disagree with what the same event
 * shows in-app. */
function utcDate(d) {
  const dt = d ? new Date(d) : new Date();
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

/* Amounts are money: render a fixed 2dp so a receipt never shows "12.5 USDT",
 * and never coerce a missing value into 0.00 — an absent amount shows as a
 * dash rather than inventing a number. */
function money(n, currency = 'USDT') {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(2) + (currency ? ' ' + currency : '');
}

/* Coin amounts carry the precision the invoice was quoted at — truncating a
 * USDT-TRC20 amount to 2dp would tell the buyer to send the wrong number. */
function coin(n, decimals = 2, ticker = '') {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  const d = Number.isFinite(decimals) ? Math.min(Math.max(decimals, 0), 18) : 2;
  return Number(n).toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + (ticker ? ' ' + ticker : '');
}

/* ---------- shell ---------- */

function shell({ subject, title, preheader, bodyHtml, bodyText, footerHint }) {
  const hint = footerHint
    || 'You are receiving this because it concerns activity on your ' + BRAND + ' account.';
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>td,div,h1,p,a{font-family:Arial,sans-serif !important;}</style>
<![endif]-->
<style>
  /* Progressive enhancement only — every rule below has an inline equivalent,
     so a client that drops this block still renders the intended design. */
  @media only screen and (max-width:600px) {
    .px { padding-left:22px !important; padding-right:22px !important; }
    .stack { display:block !important; width:100% !important; }
    .h1 { font-size:24px !important; }
    .code-cell { font-size:26px !important; padding:12px 9px !important; }
    .hide-sm { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${COLOR.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.page};">${esc(preheader || title)}&#8203;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="background:${COLOR.page};">
  <tr><td align="center" style="padding:0 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

      <!-- brand lockup, on the dark chrome -->
      <tr><td style="padding:30px 8px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="42" style="width:42px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="42" bgcolor="${COLOR.brand}" style="width:42px;height:42px;background:${COLOR.brand};border-radius:13px;">
              <tr><td align="center" valign="middle" height="42" style="height:42px;font-family:${FONT};font-size:19px;line-height:42px;color:${COLOR.brandInk};">&#9679;</td></tr>
            </table>
          </td>
          <td style="padding-left:12px;font-family:${FONT};">
            <div style="font-size:18px;line-height:1.2;font-weight:800;color:${COLOR.chromeInk};letter-spacing:-.3px;">${esc(BRAND)}</div>
            <div style="font-size:12px;line-height:1.4;color:${COLOR.chromeMuted};padding-top:2px;">${esc(TAGLINE)}</div>
          </td>
        </tr></table>
      </td></tr>

      <!-- amber rail + content card -->
      <tr><td bgcolor="${COLOR.brand}" style="background:${COLOR.brand};height:4px;line-height:4px;font-size:4px;border-radius:18px 18px 0 0;">&nbsp;</td></tr>
      <tr><td class="px" bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:0 0 18px 18px;padding:34px 38px 30px;font-family:${FONT};font-size:15px;line-height:1.65;color:${COLOR.sub};">
        ${bodyHtml}
      </td></tr>

      <!-- footer, back on the dark chrome -->
      <tr><td style="padding:24px 14px 34px;font-family:${FONT};font-size:12px;line-height:1.75;color:${COLOR.chromeMuted};text-align:center;">
        <div style="padding-bottom:10px;">
          <a href="${esc(ordersUrl())}" style="color:${COLOR.chromeMuted};text-decoration:none;">Your orders</a>
          <span style="color:${COLOR.chromeLine};padding:0 7px;">&#124;</span>
          <a href="${esc(messagesUrl())}" style="color:${COLOR.chromeMuted};text-decoration:none;">Messages</a>
          <span style="color:${COLOR.chromeLine};padding:0 7px;">&#124;</span>
          <a href="${esc(legalUrl('terms'))}" style="color:${COLOR.chromeMuted};text-decoration:none;">Terms</a>
          <span style="color:${COLOR.chromeLine};padding:0 7px;">&#124;</span>
          <a href="${esc(legalUrl('privacy'))}" style="color:${COLOR.chromeMuted};text-decoration:none;">Privacy</a>
          <span style="color:${COLOR.chromeLine};padding:0 7px;">&#124;</span>
          <a href="${esc(legalUrl('refund'))}" style="color:${COLOR.chromeMuted};text-decoration:none;">Refunds</a>
        </div>
        <div style="color:#5f5f6d;">
          ${esc(hint)}<br>
          ${esc(BRAND)} &middot; ${esc(TAGLINE)} &middot; <a href="${esc(BASE_URL)}" style="color:#5f5f6d;text-decoration:underline;">${esc(BASE_URL.replace(/^https?:\/\//, ''))}</a>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const rule = '='.repeat(Math.min(Math.max(title.length, 8), 46));
  const text = `${BRAND} — ${TAGLINE}\n\n${title}\n${rule}\n\n${bodyText}\n\n`
    + `--\nYour orders: ${ordersUrl()}\nMessages: ${messagesUrl()}\nTerms: ${legalUrl('terms')}  |  Privacy: ${legalUrl('privacy')}  |  Refunds: ${legalUrl('refund')}\n\n`
    + `${hint}\n${BRAND} · ${BASE_URL}`;

  return { subject, html, text };
}

/* ---------- building blocks ---------- */

function eyebrow(text, tone = 'brand') {
  const ink = { brand: COLOR.brandDeep, good: COLOR.good, warn: COLOR.warn, danger: COLOR.danger, info: COLOR.info }[tone] || COLOR.brandDeep;
  return `<div style="margin:0 0 9px;font-family:${FONT};font-size:11px;line-height:1.2;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${ink};">${esc(text)}</div>`;
}

function h1(s) {
  return `<h1 class="h1" style="margin:0 0 10px;font-family:${FONT};font-size:27px;line-height:1.22;font-weight:800;color:${COLOR.ink};letter-spacing:-.6px;">${esc(s)}</h1>`;
}

function h2(s) {
  return `<div style="margin:26px 0 10px;font-family:${FONT};font-size:13px;line-height:1.3;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${COLOR.muted};">${esc(s)}</div>`;
}

function lead(html) {
  return `<p style="margin:0 0 20px;font-family:${FONT};font-size:16px;line-height:1.6;color:${COLOR.sub};">${html}</p>`;
}

function p(html) {
  return `<p style="margin:0 0 15px;font-family:${FONT};font-size:15px;line-height:1.65;color:${COLOR.sub};">${html}</p>`;
}

function small(html) {
  return `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLOR.muted};">${html}</p>`;
}

function divider() {
  return `<div style="height:1px;line-height:1px;font-size:1px;background:${COLOR.borderSoft};margin:24px 0;">&nbsp;</div>`;
}

/* Status pill. Tones map to the escrow states the product actually has. */
const TONES = {
  good: [COLOR.goodWash, COLOR.goodLine, COLOR.good],
  warn: [COLOR.warnWash, COLOR.warnLine, COLOR.warn],
  danger: [COLOR.dangerWash, COLOR.dangerLine, COLOR.danger],
  brand: [COLOR.brandWash, COLOR.brandLine, COLOR.brandDeep],
  info: [COLOR.infoWash, COLOR.infoLine, COLOR.info],
};

function badge(label, tone = 'brand') {
  const [bg, line, ink] = TONES[tone] || TONES.brand;
  return `<span style="display:inline-block;padding:4px 12px;border:1px solid ${line};border-radius:999px;background:${bg};font-family:${FONT};font-size:12px;line-height:1.5;font-weight:700;color:${ink};white-space:nowrap;">${esc(label)}</span>`;
}

/* Bulletproof primary button — VML so Outlook's Word engine draws the real
 * pill instead of shrink-wrapping the anchor text. */
function button(href, label, { tone = 'brand' } = {}) {
  const bg = tone === 'dark' ? COLOR.chrome : COLOR.brand;
  const ink = tone === 'dark' ? '#ffffff' : COLOR.brandInk;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 10px;"><tr><td>
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(href)}" style="height:46px;v-text-anchor:middle;width:250px;" arcsize="24%" strokecolor="${bg}" fillcolor="${bg}">
<w:anchorlock/><center style="color:${ink};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${esc(href)}" style="display:inline-block;padding:14px 32px;background:${bg};border-radius:11px;font-family:${FONT};font-size:15px;line-height:1;font-weight:700;color:${ink};text-decoration:none;">${esc(label)}</a>
<!--<![endif]-->
</td></tr></table>
<div style="margin:0 0 4px;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLOR.faint};">Button not working? Paste this into your browser:<br><span style="font-family:${MONO};color:${COLOR.muted};word-break:break-all;">${esc(href)}</span></div>`;
}

/* Key/value block. Values are raw HTML so a caller can drop in a badge or a
 * mono span; keys are always escaped text.
 *
 * Neither column may refuse to wrap. A `white-space:nowrap` key sets a floor
 * under the table's min-content width, and since this block is the widest
 * thing in most of these emails, that floor became the whole message's — two
 * templates scrolled sideways on a 360px phone because of it. A key wrapping
 * onto two lines is a far smaller cost than that. */
function summary(rows, { title } = {}) {
  const body = rows.filter(Boolean).map(([k, v], i) => `<tr>
    <td style="padding:11px 0;${i ? `border-top:1px solid ${COLOR.borderSoft};` : ''}font-family:${FONT};font-size:13px;line-height:1.5;color:${COLOR.muted};vertical-align:top;">${esc(k)}</td>
    <td align="right" style="padding:11px 0 11px 14px;${i ? `border-top:1px solid ${COLOR.borderSoft};` : ''}font-family:${FONT};font-size:14px;line-height:1.5;font-weight:600;color:${COLOR.ink};vertical-align:top;text-align:right;overflow-wrap:break-word;word-break:break-word;">${v}</td>
  </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.wash}" style="margin:18px 0;background:${COLOR.wash};border:1px solid ${COLOR.border};border-radius:14px;">
    <tr><td style="padding:6px 20px;">
      ${title ? `<div style="padding:12px 0 4px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:${COLOR.faint};">${esc(title)}</div>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
    </td></tr>
  </table>`;
}

/* The headline number on a receipt. */
/* Pass `display` to render an already-formatted figure (a coin amount at its
 * own precision, say) instead of a USDT-formatted `amount`. */
function amountHero(amount, { label = 'Amount', currency = 'USDT', tone = 'good', note: sub, display } = {}) {
  const [bg, line, ink] = TONES[tone] || TONES.good;
  const figure = display != null ? String(display) : money(amount, currency);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="margin:20px 0;background:${bg};border:1px solid ${line};border-radius:16px;">
    <tr><td align="center" style="padding:24px 20px;font-family:${FONT};">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${ink};opacity:.75;">${esc(label)}</div>
      <div style="padding-top:7px;font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-1px;color:${ink};">${esc(figure)}</div>
      ${sub ? `<div style="padding-top:7px;font-size:13px;line-height:1.5;color:${ink};opacity:.8;">${sub}</div>` : ''}
    </td></tr>
  </table>`;
}

/* One-time code as separate digit cells, on the brand's dark chrome. */
function codeDigits(code) {
  const chars = String(code == null ? '' : code).split('');
  const cells = chars.map((c, i) => (i ? `<td width="7" style="width:7px;font-size:1px;line-height:1px;">&nbsp;</td>` : '')
    + `<td class="code-cell" align="center" bgcolor="${COLOR.chrome}" style="background:${COLOR.chrome};border-radius:11px;padding:15px 13px;font-family:${MONO};font-size:31px;line-height:1;font-weight:700;color:${COLOR.brand};">${esc(c)}</td>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;"><tr>${cells}</tr></table>
    <div style="margin:0 0 20px;text-align:center;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLOR.faint};">Can&rsquo;t read the boxes? The code is <span style="font-family:${MONO};color:${COLOR.ink};font-weight:700;letter-spacing:1px;">${esc(code)}</span></div>`;
}

/* Monospace block for a credential, address or hash. `label` names it, so a
 * buyer looking at three of them knows which is which.
 *
 * Line breaks are turned into <br> because the content is nearly always
 * multi-line — a stocked credential is "login: …\npassword: …\nprofile: …",
 * and HTML collapsing those newlines ran the whole thing together as one
 * wrapped paragraph, which is precisely the text a buyer has to copy
 * accurately. (white-space:pre-wrap would do it too, but the Word engine in
 * Outlook ignores it.) */
function monoBox(content, { label, wash = COLOR.wash } = {}) {
  const body = esc(content).replace(/\r\n|\r|\n/g, '<br>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${wash}" style="margin:16px 0;background:${wash};border:1px solid ${COLOR.border};border-radius:13px;">
    <tr><td style="padding:16px 18px;font-family:${MONO};">
      ${label ? `<div style="padding-bottom:7px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:${COLOR.faint};">${esc(label)}</div>` : ''}
      <div style="font-size:14px;line-height:1.7;color:${COLOR.ink};word-break:break-word;overflow-wrap:anywhere;">${body}</div>
    </td></tr>
  </table>`;
}

function note(innerHtml, { tone = 'warn', title } = {}) {
  const [bg, line, ink] = TONES[tone] || TONES.warn;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="margin:20px 0;background:${bg};border:1px solid ${line};border-radius:13px;">
    <tr><td style="padding:15px 18px;font-family:${FONT};font-size:13.5px;line-height:1.65;color:${ink};">
      ${title ? `<div style="padding-bottom:4px;font-weight:700;">${esc(title)}</div>` : ''}${innerHtml}
    </td></tr>
  </table>`;
}

/* Numbered steps with real circled numerals (a plain <ol> renders its markers
 * inconsistently across clients and can't be styled at all in Outlook). */
function steps(items) {
  const rows = items.map((item, i) => `<tr>
    <td width="30" valign="top" style="width:30px;padding:0 12px 12px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="24" bgcolor="${COLOR.brand}" style="width:24px;background:${COLOR.brand};border-radius:12px;">
        <tr><td align="center" height="24" style="height:24px;font-family:${FONT};font-size:12px;line-height:24px;font-weight:800;color:${COLOR.brandInk};">${i + 1}</td></tr>
      </table>
    </td>
    <td valign="top" style="padding:2px 0 12px;font-family:${FONT};font-size:14.5px;line-height:1.6;color:${COLOR.sub};">${item}</td>
  </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 12px;">${rows}</table>`;
}

/* Vertical escrow timeline. Each step is { label, detail, state } where state
 * is 'done' | 'current' | 'todo'. Vertical rather than horizontal because a
 * three-across rail collapses unreadably on a phone and in Outlook. */
function timeline(entries) {
  const rows = entries.map((s, i) => {
    const last = i === entries.length - 1;
    const done = s.state === 'done';
    const current = s.state === 'current';
    const dotBg = done ? COLOR.good : current ? COLOR.brand : COLOR.card;
    const dotBorder = done ? COLOR.good : current ? COLOR.brand : COLOR.border;
    const glyph = done ? `<span style="font-family:${FONT};font-size:11px;line-height:18px;color:#ffffff;">&#10003;</span>` : '&nbsp;';
    const labelInk = done || current ? COLOR.ink : COLOR.faint;
    const railColor = done ? COLOR.goodLine : COLOR.border;
    return `<tr>
      <td width="30" valign="top" style="width:30px;padding:0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="18" style="width:18px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="18" bgcolor="${dotBg}" style="width:18px;background:${dotBg};border:2px solid ${dotBorder};border-radius:11px;">
            <tr><td align="center" height="18" style="height:18px;line-height:18px;font-size:11px;">${glyph}</td></tr>
          </table>
        </td></tr>
        ${last ? '' : `<tr><td align="center" style="padding:3px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="2" bgcolor="${railColor}" style="width:2px;background:${railColor};"><tr><td height="26" style="height:26px;line-height:26px;font-size:1px;">&nbsp;</td></tr></table></td></tr>`}
        </table>
      </td>
      <td valign="top" style="padding:0 0 ${last ? '0' : '14px'} 12px;font-family:${FONT};">
        <div style="font-size:14.5px;line-height:1.35;font-weight:${done || current ? '700' : '600'};color:${labelInk};">${esc(s.label)}${current ? ` <span style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:${COLOR.brandDeep};">&middot; now</span>` : ''}</div>
        ${s.detail ? `<div style="padding-top:3px;font-size:13px;line-height:1.55;color:${COLOR.muted};">${s.detail}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 22px;">${rows}</table>`;
}

/* Plain-text renderings of the same structures, so the text/plain part is a
 * real document rather than a stripped-tag soup. */
const tLine = (rows) => rows.filter(Boolean).map(([k, v]) => `  ${k}: ${v}`).join('\n');
const tSteps = (items) => items.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
const tTimeline = (entries) => entries.map(s =>
  `  [${s.state === 'done' ? 'x' : s.state === 'current' ? '>' : ' '}] ${s.label}${s.detail ? ' — ' + s.detail : ''}`).join('\n');

/* Escrow timeline shared by the buyer-side order emails, so "where is my
 * money" is answered identically at every stage. */
function escrowTimeline(stage, { paidAt, deliveredAt } = {}) {
  const at = (d) => utcDate(d);
  const order = ['paid', 'delivered', 'released'];
  const idx = order.indexOf(stage);
  const state = (i) => (i < idx ? 'done' : i === idx ? 'current' : 'todo');
  return [
    { label: 'Payment held in escrow', state: state(0), detail: paidAt ? at(paidAt) : 'Funds locked — the seller cannot touch them' },
    { label: 'Seller delivers', state: state(1), detail: deliveredAt ? at(deliveredAt) : 'By auto-delivery or in the deal chat' },
    { label: 'You confirm \u2192 seller is paid', state: state(2), detail: 'Release only happens when you say the goods are good' },
  ];
}

/* ---------- templates: accounts ---------- */

function verificationEmail({ name, code, minutes = 10, requestedAt } = {}) {
  const expiresAt = new Date(Date.now() + (Number(minutes) || 10) * 60000);
  const rows = [
    ['Verification code', `<span style="font-family:${MONO};letter-spacing:2px;">${esc(code)}</span>`],
    ['Valid for', esc(`${minutes} minutes`)],
    ['Expires at', esc(utcDate(expiresAt))],
    ['Requested', esc(utcDate(requestedAt))],
  ];
  return shell({
    subject: `${code} is your ${BRAND} verification code`,
    title: 'Confirm your email address',
    preheader: `${code} — valid for ${minutes} minutes. Don't share this code with anyone.`,
    bodyHtml:
      eyebrow('Verify your account') +
      h1('Confirm your email') +
      lead(`${name ? 'Hi ' + esc(name) + ', w' : 'W'}elcome to ${esc(BRAND)}. Enter this code to confirm you own this address and finish securing your account.`) +
      codeDigits(code) +
      summary(rows, { title: 'Code details' }) +
      note(
        `Nobody at ${esc(BRAND)} will ever ask you for this code &mdash; not by email, not in a deal chat, not in support. Anyone who does is trying to take your account.`,
        { tone: 'danger', title: 'Never share this code' }
      ) +
      small(`<b>Didn&rsquo;t request it?</b> Someone may have typed your address by mistake. No account is verified until the code is used, so you can safely ignore this email. If codes keep arriving, change your password.`),
    bodyText:
      `${name ? 'Hi ' + name + ', w' : 'W'}elcome to ${BRAND}. Enter this code to confirm your email address:\n\n`
      + `    ${code}\n\n`
      + tLine([
        ['Valid for', `${minutes} minutes`],
        ['Expires at', utcDate(expiresAt)],
        ['Requested', utcDate(requestedAt)],
      ])
      + `\n\nNEVER SHARE THIS CODE. Nobody at ${BRAND} will ever ask you for it — not by email, not in a deal chat, not in support.\n\n`
      + `Didn't request it? No account is verified until the code is used, so you can ignore this email.`,
    footerHint: 'You are receiving this because this address was used to sign up for ' + BRAND + '.',
  });
}

function welcomeEmail(name) {
  const items = [
    `<b>Pay into escrow.</b> Your money goes to the platform, not the seller &mdash; it is locked the moment you pay.`,
    `<b>The seller delivers.</b> Stocked listings auto-deliver in seconds; everything else arrives in the deal chat.`,
    `<b>You check, then confirm.</b> The seller is paid only after you release the escrow. If something is wrong, open a dispute instead and an arbiter reads the whole chat.`,
  ];
  return shell({
    subject: `Welcome to ${BRAND} — here's how escrow protects you`,
    title: `Welcome to ${BRAND}`,
    preheader: 'Your account is ready. Every deal is protected by escrow — here is exactly how it works.',
    bodyHtml:
      eyebrow('Account ready') +
      h1(name ? `Welcome, ${name}` : 'Welcome aboard') +
      lead(`Your ${esc(BRAND)} account is set up. Before your first purchase, it is worth knowing exactly what protects it.`) +
      h2('How every order works') +
      steps(items) +
      note(
        `Payments are on-chain and final &mdash; there is no card processor and no chargeback. That is precisely why escrow exists: the platform holds the funds until you say the goods arrived.`,
        { tone: 'info', title: 'Why escrow, and not a card' }
      ) +
      h2('Thinking of selling?') +
      p(`Seller accounts are invite-only, so buyers know every seller was vetted by an administrator. Stock your credentials on a listing and we auto-deliver them the second a buyer pays.`) +
      button(appUrl(''), 'Start browsing'),
    bodyText:
      `Your ${BRAND} account is set up. How every order works:\n\n`
      + tSteps([
        'Pay into escrow. Your money goes to the platform, not the seller — locked the moment you pay.',
        'The seller delivers. Stocked listings auto-deliver in seconds; everything else arrives in the deal chat.',
        'You check, then confirm. The seller is paid only after you release the escrow. If something is wrong, open a dispute and an arbiter reads the whole chat.',
      ])
      + `\n\nPayments are on-chain and final — no card processor, no chargeback. That is exactly why escrow exists.\n\n`
      + `Selling? Seller accounts are invite-only, so buyers know every seller was vetted.\n\nStart browsing: ${appUrl('')}`,
  });
}

/* ---------- templates: buying ---------- */

/* Crypto checkout instructions. The single highest-stakes email the platform
 * sends: an on-chain transfer to the wrong network or the wrong amount is
 * unrecoverable, so the warnings are as prominent as the address itself. */
function paymentInstructionsEmail({ title, orderId, address, amount, decimals, ticker, networkLabel, amountUsd, expiresAt, confirmMinutes } = {}) {
  const net = networkLabel || ticker || 'the network shown';
  const exact = coin(amount, decimals, ticker);
  return shell({
    subject: `Send ${exact} to complete order ${orderId}`,
    title: 'Complete your payment',
    preheader: `Send exactly ${exact} on ${net}. The invoice expires ${expiresAt ? utcDate(expiresAt) : 'shortly'}.`,
    bodyHtml:
      eyebrow('Awaiting payment', 'warn') +
      h1('Finish your payment') +
      lead(`Your order for <b>${esc(title || 'your item')}</b> is reserved. Send the exact amount below to the deposit address and we will confirm it on-chain automatically &mdash; no receipt to upload, nothing to click.`) +
      amountHero(null, { label: 'Send exactly', tone: 'brand', display: exact }) +
      monoBox(address, { label: `Deposit address \u00b7 ${net}` }) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Network', esc(net)],
        ['Exact amount', `<span style="font-family:${MONO};">${esc(exact)}</span>`],
        amountUsd != null ? ['Value', esc(money(amountUsd, 'USD'))] : null,
        confirmMinutes ? ['Usually confirms in', esc(`about ${confirmMinutes} min`)] : null,
        expiresAt ? ['Invoice expires', esc(utcDate(expiresAt))] : null,
      ], { title: 'Payment details' }) +
      note(
        `<b>Send on ${esc(net)} only.</b> The same address string can exist on another chain, and a transfer that lands there is gone for good.<br>`
        + `<b>Send the exact amount.</b> Underpaying leaves the order unpaid; the difference is not credited automatically.<br>`
        + `<b>Use this address once.</b> Addresses are recycled between invoices &mdash; a later transfer to it is not credited to this order.`,
        { tone: 'danger', title: 'On-chain transfers cannot be reversed' }
      ) +
      p(`Once the network confirms your transfer, the funds go straight into escrow and you will get a payment confirmation with your receipt.`) +
      button(ordersUrl(), 'Track this order'),
    bodyText:
      `Your order for ${title || 'your item'} is reserved. Send the exact amount below to complete it.\n\n`
      + `    Send exactly: ${exact}\n    Address:      ${address}\n    Network:      ${net}\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        amountUsd != null ? ['Value', money(amountUsd, 'USD')] : null,
        confirmMinutes ? ['Usually confirms in', `about ${confirmMinutes} min`] : null,
        expiresAt ? ['Invoice expires', utcDate(expiresAt)] : null,
      ])
      + `\n\nON-CHAIN TRANSFERS CANNOT BE REVERSED:\n`
      + `  - Send on ${net} ONLY. The same address can exist on another chain; a transfer there is gone for good.\n`
      + `  - Send the EXACT amount. Underpaying leaves the order unpaid.\n`
      + `  - Use this address ONCE. Addresses are recycled between invoices.\n\n`
      + `Track this order: ${ordersUrl()}`,
  });
}

/* NOTE on fees (lib/fees.js): the PLATFORM fee is deducted from the seller's
 * payout — the buyer never pays it — while the GATEWAY fee is added on top of
 * the listing price and is the buyer's (gatewayFeePaidBy: 'buyer'). A buyer
 * receipt that lists the platform fee is billing them for someone else's cost,
 * so this one shows only what actually left their side. */
function paymentConfirmedEmail({ title, amount, orderId, paidAt, networkLabel, txHash, listingAmount, gatewayFee, buyerTotal } = {}) {
  const entries = escrowTimeline('paid', { paidAt });
  const price = listingAmount != null ? listingAmount : amount;
  const total = buyerTotal != null ? buyerTotal : price;
  const chargedGateway = gatewayFee != null && Number(gatewayFee) > 0;
  return shell({
    subject: `Payment confirmed — ${title || orderId} is in escrow`,
    title: 'Payment confirmed',
    preheader: `${money(buyerTotal != null ? buyerTotal : (listingAmount != null ? listingAmount : amount))} is held in escrow for ${title || orderId}. The seller is paid only after you confirm delivery.`,
    bodyHtml:
      eyebrow('Payment received', 'good') +
      h1('Your payment is in escrow') +
      lead(`Thanks &mdash; we have confirmed your payment for <b>${esc(title || 'your order')}</b>. It is now held by ${esc(BRAND)}, not the seller.`) +
      amountHero(total, { label: 'Total paid', tone: 'good', note: 'Held in escrow — released to the seller only when you confirm delivery' }) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        // Only break the total down when there is something to break down —
        // a wallet purchase charges no network fee, and printing the same
        // figure twice reads like a mistake.
        chargedGateway ? ['Item price', esc(money(price))] : null,
        chargedGateway ? ['Network fee', `+ ${esc(money(gatewayFee))}`] : null,
        ['Total paid', `<b>${esc(money(total))}</b>`],
        ['Confirmed', esc(utcDate(paidAt))],
        networkLabel ? ['Paid via', esc(networkLabel)] : null,
        txHash ? ['Transaction', `<span style="font-family:${MONO};font-size:12px;word-break:break-all;">${esc(txHash)}</span>`] : null,
        ['Status', badge('In escrow', 'good')],
      ], { title: 'Receipt' }) +
      h2('What happens next') +
      timeline(entries) +
      button(ordersUrl(), 'View your order') +
      note(
        `If the item never arrives, or it does not match the listing, <b>open a dispute from the deal instead of confirming</b>. The escrow keeps your money while an arbiter reads the deal chat. Once you confirm delivery, the release is final.`,
        { tone: 'brand', title: 'Your money is protected' }
      ),
    bodyText:
      `We confirmed your payment for ${title || 'your order'}. It is held in escrow by ${BRAND}, not the seller.\n\n`
      + `    Total paid: ${money(total)}\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        chargedGateway ? ['Item price', money(price)] : null,
        chargedGateway ? ['Network fee', '+ ' + money(gatewayFee)] : null,
        ['Total paid', money(total)],
        ['Confirmed', utcDate(paidAt)],
        networkLabel ? ['Paid via', networkLabel] : null,
        txHash ? ['Transaction', txHash] : null,
        ['Status', 'In escrow'],
      ])
      + `\n\nWhat happens next:\n` + tTimeline(entries)
      + `\n\nYOUR MONEY IS PROTECTED: if the item never arrives or does not match the listing, open a dispute instead of confirming. Once you confirm delivery, the release is final.\n\n`
      + `View your order: ${ordersUrl()}`,
  });
}

function credentialEmail({ title, orderId, credential, deliveredAt } = {}) {
  const entries = escrowTimeline('delivered', { deliveredAt });
  return shell({
    subject: `Delivered — your credentials for ${title || orderId}`,
    title: 'Your delivery is here',
    preheader: `Your credentials for ${title || 'your order'} are inside. Check them, then confirm delivery.`,
    bodyHtml:
      eyebrow('Auto-delivered', 'good') +
      h1('Your delivery is here') +
      lead(`Your order for <b>${esc(title || 'your item')}</b> was delivered automatically from the seller&rsquo;s stock. Here is what you bought:`) +
      monoBox(credential, { label: 'Your credentials', wash: COLOR.brandWash }) +
      note(
        `Anyone holding these can use the account. Do not paste them into a chat, a screenshot or a support ticket. If the listing allows it, change the password as soon as you sign in.`,
        { tone: 'danger', title: 'Keep these private' }
      ) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Delivered', esc(utcDate(deliveredAt))],
        ['Delivery', 'Automatic, from seller stock'],
        ['Status', badge('Awaiting your confirmation', 'warn')],
      ], { title: 'Order' }) +
      h2('One step left') +
      timeline(entries) +
      p(`Check the credentials work <b>before</b> you confirm. Confirming releases the escrow to the seller and cannot be undone.`) +
      p(`Something wrong? Open the deal chat and give the seller a chance to fix it &mdash; and if that goes nowhere, open a dispute while your money is still in escrow.`) +
      button(ordersUrl(), 'Check and confirm'),
    bodyText:
      `Your order for ${title || 'your item'} was auto-delivered from the seller's stock.\n\n`
      + `YOUR CREDENTIALS\n${credential}\n\n`
      + `KEEP THESE PRIVATE — anyone holding them can use the account. Don't paste them into a chat, a screenshot or a support ticket.\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Delivered', utcDate(deliveredAt)],
        ['Status', 'Awaiting your confirmation'],
      ])
      + `\n\nOne step left:\n` + tTimeline(entries)
      + `\n\nCheck the credentials work BEFORE you confirm — confirming releases the escrow to the seller and cannot be undone.\n\n`
      + `Check and confirm: ${ordersUrl()}`,
  });
}

function orderDeliveredEmail({ title, orderId, amount, deliveredAt, proof, sellerName } = {}) {
  const entries = escrowTimeline('delivered', { deliveredAt });
  return shell({
    subject: `Delivered — confirm ${title || orderId} to release the escrow`,
    title: 'The seller marked your order delivered',
    preheader: `${title || 'Your order'} is marked delivered. Check it, then confirm to release ${money(amount)}.`,
    bodyHtml:
      eyebrow('Action needed', 'warn') +
      h1('Marked delivered') +
      lead(`${sellerName ? esc(sellerName) : 'The seller'} has marked <b>${esc(title || 'your order')}</b> as delivered. Your ${esc(money(amount))} is still in escrow &mdash; it moves only when you say so.`) +
      (proof ? monoBox(proof, { label: 'Delivery note from the seller' }) : '') +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Held in escrow', esc(money(amount))],
        ['Marked delivered', esc(utcDate(deliveredAt))],
        ['Status', badge('Awaiting your confirmation', 'warn')],
      ], { title: 'Order' }) +
      timeline(entries) +
      h2('Before you confirm') +
      steps([
        `<b>Check it actually works.</b> Sign in, open the file, use the key &mdash; whatever the listing promised.`,
        `<b>Confirm delivery</b> if it is right. That releases the escrow to the seller and is final.`,
        `<b>Or open a dispute</b> if it is not. Your money stays in escrow and an arbiter reads the deal chat.`,
      ]) +
      button(ordersUrl(), 'Review and confirm') +
      note(`A seller marking an order delivered does <b>not</b> move any money. Only your confirmation, or an arbiter&rsquo;s decision on a dispute, does that.`, { tone: 'info' }),
    bodyText:
      `${sellerName || 'The seller'} marked ${title || 'your order'} as delivered. Your ${money(amount)} is still in escrow — it moves only when you say so.\n\n`
      + (proof ? `Delivery note from the seller:\n${proof}\n\n` : '')
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Held in escrow', money(amount)],
        ['Marked delivered', utcDate(deliveredAt)],
      ])
      + `\n\nBefore you confirm:\n`
      + tSteps([
        'Check it actually works — sign in, open the file, use the key.',
        'Confirm delivery if it is right. That releases the escrow and is final.',
        'Or open a dispute if it is not. Your money stays in escrow.',
      ])
      + `\n\nA seller marking an order delivered does NOT move any money. Only your confirmation, or an arbiter's decision, does.\n\n`
      + `Review and confirm: ${ordersUrl()}`,
  });
}

function escrowReleasedBuyerEmail({ title, orderId, amount, releasedAt, sellerName } = {}) {
  const entries = escrowTimeline('released', { });
  entries[2].state = 'done';
  entries[2].detail = utcDate(releasedAt);
  return shell({
    subject: `Order complete — ${title || orderId}`,
    title: 'Order complete',
    preheader: `You released ${money(amount)} to the seller. Here is your final receipt.`,
    bodyHtml:
      eyebrow('Deal closed', 'good') +
      h1('Order complete') +
      lead(`You confirmed delivery of <b>${esc(title || 'your order')}</b>, so the escrow has been released${sellerName ? ' to ' + esc(sellerName) : ''}. That closes the deal.`) +
      amountHero(amount, { label: 'Released to the seller', tone: 'good' }) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Released', esc(utcDate(releasedAt))],
        ['Status', badge('Complete', 'good')],
      ], { title: 'Final receipt' }) +
      timeline(entries) +
      p(`Keep this email &mdash; it is your record of the deal. The deal chat stays in your messages, so the delivery and anything the seller sent you remain readable.`) +
      p(`Was the seller good to deal with? A review is the main signal other buyers have to go on.`) +
      button(ordersUrl(), 'Leave a review'),
    bodyText:
      `You confirmed delivery of ${title || 'your order'}, so the escrow has been released${sellerName ? ' to ' + sellerName : ''}. That closes the deal.\n\n`
      + `    Released to the seller: ${money(amount)}\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Released', utcDate(releasedAt)],
        ['Status', 'Complete'],
      ])
      + `\n\nKeep this email — it is your record of the deal. The deal chat stays in your messages.\n\n`
      + `Leave a review: ${ordersUrl()}`,
  });
}

function refundEmail({ title, orderId, amount, refundedAt, reason, destination } = {}) {
  return shell({
    subject: `Refunded — ${money(amount)} returned for ${title || orderId}`,
    title: 'Your refund has been issued',
    preheader: `${money(amount)} has been returned to you for ${title || orderId}.`,
    bodyHtml:
      eyebrow('Refund issued', 'good') +
      h1('Your money is back') +
      lead(`The escrow on <b>${esc(title || 'your order')}</b> has been refunded. Nothing was paid to the seller, and no platform fee was charged.`) +
      amountHero(amount, { label: 'Refunded to you', tone: 'good', note: destination ? esc(destination) : 'Credited to your Dot Wallet balance' }) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Refunded', esc(utcDate(refundedAt))],
        reason ? ['Reason', esc(reason)] : null,
        ['Platform fee', 'None — a refunded deal is never charged'],
        ['Status', badge('Refunded', 'good')],
      ], { title: 'Refund details' }) +
      p(`A refunded escrow is terminal: this order cannot be released to the seller afterwards, so there is nothing further you need to do.`) +
      button(walletUrl(), 'Open your wallet'),
    bodyText:
      `The escrow on ${title || 'your order'} has been refunded. Nothing was paid to the seller, and no platform fee was charged.\n\n`
      + `    Refunded to you: ${money(amount)}${destination ? '\n    Destination: ' + destination : ''}\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Refunded', utcDate(refundedAt)],
        reason ? ['Reason', reason] : null,
        ['Platform fee', 'None — a refunded deal is never charged'],
      ])
      + `\n\nA refunded escrow is terminal: this order cannot be released to the seller afterwards.\n\nOpen your wallet: ${walletUrl()}`,
  });
}

/* ---------- templates: disputes ---------- */

function disputeOpenedEmail({ title, orderId, amount, reason, openedAt, audience = 'seller' } = {}) {
  const forSeller = audience === 'seller';
  return shell({
    subject: forSeller
      ? `Dispute opened on ${title || orderId} — respond in the deal chat`
      : `Dispute opened — your ${money(amount)} stays in escrow`,
    title: 'A dispute has been opened',
    preheader: forSeller
      ? `The buyer disputed ${title || orderId}. The escrow is frozen until an arbiter decides.`
      : `Your ${money(amount)} stays in escrow while an arbiter reviews ${title || orderId}.`,
    bodyHtml:
      eyebrow('Dispute open', 'danger') +
      h1(forSeller ? 'A buyer opened a dispute' : 'Your dispute is open') +
      lead(forSeller
        ? `The buyer has disputed <b>${esc(title || 'this order')}</b>. The escrow is frozen &mdash; it can no longer be released or refunded by either of you, only by an arbiter.`
        : `We have logged your dispute on <b>${esc(title || 'this order')}</b>. Your money stays exactly where it is: in escrow, out of the seller&rsquo;s reach.`) +
      (reason ? monoBox(reason, { label: forSeller ? 'What the buyer reported' : 'What you reported' }) : '') +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Amount frozen', esc(money(amount))],
        ['Opened', esc(utcDate(openedAt))],
        ['Status', badge('Under review', 'danger')],
      ], { title: 'Dispute' }) +
      h2('How this gets resolved') +
      steps(forSeller ? [
        `<b>Reply in the deal chat.</b> It is the record the arbiter reads &mdash; anything not in it effectively did not happen.`,
        `<b>Post your proof</b> there: delivery timestamps, screenshots, whatever shows the goods were as listed.`,
        `<b>An arbiter decides</b> and either releases the escrow to you or refunds the buyer. That decision is final.`,
      ] : [
        `<b>Explain it in the deal chat.</b> That thread is what the arbiter reads, so put the detail there.`,
        `<b>Attach your evidence</b> &mdash; screenshots of what arrived, what failed, what the listing promised.`,
        `<b>An arbiter decides</b> and either refunds you or releases the escrow to the seller. That decision is final.`,
      ]) +
      note(`The deal chat cannot be destroyed while an escrow is live, so neither side can erase the record this decision rests on.`, { tone: 'info' }) +
      button(messagesUrl(), 'Open the deal chat'),
    bodyText:
      (forSeller
        ? `The buyer has disputed ${title || 'this order'}. The escrow is frozen — it can no longer be released or refunded by either of you, only by an arbiter.`
        : `We have logged your dispute on ${title || 'this order'}. Your money stays in escrow, out of the seller's reach.`)
      + `\n\n` + (reason ? `${forSeller ? 'What the buyer reported' : 'What you reported'}:\n${reason}\n\n` : '')
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Amount frozen', money(amount)],
        ['Opened', utcDate(openedAt)],
        ['Status', 'Under review'],
      ])
      + `\n\nHow this gets resolved:\n`
      + tSteps(forSeller ? [
        'Reply in the deal chat — it is the record the arbiter reads.',
        'Post your proof there: delivery timestamps, screenshots, anything showing the goods were as listed.',
        'An arbiter decides and either releases the escrow to you or refunds the buyer. That decision is final.',
      ] : [
        'Explain it in the deal chat — that thread is what the arbiter reads.',
        'Attach your evidence: what arrived, what failed, what the listing promised.',
        'An arbiter decides and either refunds you or releases the escrow. That decision is final.',
      ])
      + `\n\nThe deal chat cannot be destroyed while an escrow is live, so neither side can erase the record.\n\nOpen the deal chat: ${messagesUrl()}`,
  });
}

function disputeResolvedEmail({ title, orderId, amount, outcome, resolvedAt, audience = 'buyer', note: arbiterNote } = {}) {
  const refunded = outcome === 'refunded';
  const forBuyer = audience === 'buyer';
  const wonIt = refunded === forBuyer;
  const headline = refunded ? 'Refunded to the buyer' : 'Released to the seller';
  return shell({
    subject: `Dispute resolved — ${headline.toLowerCase()} on ${title || orderId}`,
    title: 'Dispute resolved',
    preheader: `An arbiter has decided ${title || orderId}: ${headline.toLowerCase()}.`,
    bodyHtml:
      eyebrow('Decision made', wonIt ? 'good' : 'info') +
      h1('An arbiter has decided') +
      lead(`The dispute on <b>${esc(title || 'this order')}</b> has been resolved. ${refunded
        ? `The escrow was <b>refunded to the buyer</b>; the seller was not paid and no platform fee was charged.`
        : `The escrow was <b>released to the seller</b>; the buyer was not refunded.`}`) +
      amountHero(amount, { label: headline, tone: wonIt ? 'good' : 'info' }) +
      (arbiterNote ? monoBox(arbiterNote, { label: 'Arbiter’s note' }) : '') +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Outcome', badge(refunded ? 'Refunded' : 'Released', refunded ? 'good' : 'info')],
        ['Resolved', esc(utcDate(resolvedAt))],
      ], { title: 'Resolution' }) +
      p(`This decision is final and the escrow is now terminal &mdash; it cannot be released or refunded again. The deal chat remains in your messages as the record of what was decided and why.`) +
      button(ordersUrl(), 'View the order'),
    bodyText:
      `The dispute on ${title || 'this order'} has been resolved. `
      + (refunded
        ? `The escrow was REFUNDED TO THE BUYER; the seller was not paid and no platform fee was charged.`
        : `The escrow was RELEASED TO THE SELLER; the buyer was not refunded.`)
      + `\n\n    ${headline}: ${money(amount)}\n\n`
      + (arbiterNote ? `Arbiter's note:\n${arbiterNote}\n\n` : '')
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Outcome', refunded ? 'Refunded' : 'Released'],
        ['Resolved', utcDate(resolvedAt)],
      ])
      + `\n\nThis decision is final and the escrow is terminal. The deal chat remains in your messages.\n\nView the order: ${ordersUrl()}`,
  });
}

/* ---------- templates: selling ---------- */

function sellerSaleEmail({ title, amount, orderId, paidAt, buyerName, platformFee, sellerNet } = {}) {
  return shell({
    subject: `Sale — ${title || orderId} sold for ${money(amount)}`,
    title: 'You made a sale',
    preheader: `${title || 'Your item'} sold for ${money(amount)}. Deliver it to get paid.`,
    bodyHtml:
      eyebrow('New sale', 'good') +
      h1('You made a sale') +
      lead(`${buyerName ? esc(buyerName) : 'A buyer'} just paid for <b>${esc(title || 'your item')}</b>. The money is in escrow and becomes yours the moment they confirm delivery.`) +
      amountHero(sellerNet != null ? sellerNet : amount, {
        label: sellerNet != null ? 'Your payout after fees' : 'Sale amount',
        tone: 'good',
        note: sellerNet != null && platformFee != null
          ? `${esc(money(amount))} sale &minus; ${esc(money(platformFee))} platform fee`
          : 'Released to your balance when the buyer confirms',
      }) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Buyer paid', esc(money(amount))],
        platformFee != null ? ['Platform fee', `&minus; ${esc(money(platformFee))}`] : null,
        sellerNet != null ? ['Your payout', esc(money(sellerNet))] : null,
        ['Paid at', esc(utcDate(paidAt))],
        ['Status', badge('In escrow', 'warn')],
      ], { title: 'Sale' }) +
      h2('Getting paid') +
      steps([
        `<b>Deliver now.</b> Stocked listings already auto-delivered; otherwise send the goods in the deal chat.`,
        `<b>Mark it delivered</b> in your seller portal so the buyer is prompted to confirm.`,
        `<b>The buyer confirms</b> and the payout lands in your balance, ready to withdraw.`,
      ]) +
      note(`Deliver quickly and keep everything inside the deal chat. If the buyer disputes, that thread is the only record an arbiter reads &mdash; a delivery you can&rsquo;t point to there is a delivery you can&rsquo;t prove.`, { tone: 'warn', title: 'Protect yourself' }) +
      button(sellerPortalUrl(), 'Open your seller portal'),
    bodyText:
      `${buyerName || 'A buyer'} just paid for ${title || 'your item'}. The money is in escrow and becomes yours the moment they confirm delivery.\n\n`
      + `    ${sellerNet != null ? 'Your payout after fees' : 'Sale amount'}: ${money(sellerNet != null ? sellerNet : amount)}\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Buyer paid', money(amount)],
        platformFee != null ? ['Platform fee', '- ' + money(platformFee)] : null,
        sellerNet != null ? ['Your payout', money(sellerNet)] : null,
        ['Paid at', utcDate(paidAt)],
        ['Status', 'In escrow'],
      ])
      + `\n\nGetting paid:\n`
      + tSteps([
        'Deliver now. Stocked listings already auto-delivered; otherwise send the goods in the deal chat.',
        'Mark it delivered in your seller portal so the buyer is prompted to confirm.',
        'The buyer confirms and the payout lands in your balance, ready to withdraw.',
      ])
      + `\n\nPROTECT YOURSELF: keep everything inside the deal chat. If the buyer disputes, that thread is the only record an arbiter reads.\n\n`
      + `Seller portal: ${sellerPortalUrl()}`,
  });
}

function payoutReleasedEmail({ title, orderId, gross, fee, net, releasedAt, balance } = {}) {
  return shell({
    subject: `Paid out — ${money(net)} added to your balance`,
    title: 'Escrow released — you have been paid',
    preheader: `The buyer confirmed ${title || orderId}. ${money(net)} is now in your balance.`,
    bodyHtml:
      eyebrow('Payout released', 'good') +
      h1('You have been paid') +
      lead(`The buyer confirmed delivery of <b>${esc(title || 'your item')}</b>, so the escrow has been released. Your share is in your balance and available to withdraw.`) +
      amountHero(net, { label: 'Added to your balance', tone: 'good', note: balance != null ? `New balance: ${esc(money(balance))}` : null }) +
      summary([
        ['Item', esc(title || '—')],
        ['Order', `<span style="font-family:${MONO};">${esc(orderId)}</span>`],
        ['Sale amount', esc(money(gross))],
        fee != null ? ['Platform fee', `&minus; ${esc(money(fee))}`] : null,
        ['Your payout', `<b>${esc(money(net))}</b>`],
        ['Released', esc(utcDate(releasedAt))],
        ['Status', badge('Paid', 'good')],
      ], { title: 'Payout breakdown' }) +
      p(`This deal now counts towards your completed-deal total on your public seller profile &mdash; the number buyers weigh before they trust a listing.`) +
      button(sellerPortalUrl(), 'Withdraw your balance'),
    bodyText:
      `The buyer confirmed delivery of ${title || 'your item'}, so the escrow has been released. Your share is in your balance.\n\n`
      + `    Added to your balance: ${money(net)}${balance != null ? `\n    New balance: ${money(balance)}` : ''}\n\n`
      + tLine([
        ['Item', title || '—'],
        ['Order', orderId],
        ['Sale amount', money(gross)],
        fee != null ? ['Platform fee', '- ' + money(fee)] : null,
        ['Your payout', money(net)],
        ['Released', utcDate(releasedAt)],
      ])
      + `\n\nThis deal counts towards your completed-deal total on your public seller profile.\n\nWithdraw: ${sellerPortalUrl()}`,
  });
}

function sellerApprovedEmail({ name, email } = {}) {
  return shell({
    subject: `You're verified — start listing on ${BRAND}`,
    title: 'Your seller account is verified',
    preheader: 'An administrator approved your seller account. You can list and sell right away.',
    bodyHtml:
      eyebrow('Seller verified', 'good') +
      h1(name ? `You’re verified, ${name}` : 'You’re verified') +
      lead(`An administrator has approved <b>${esc(email || 'your account')}</b> as a seller. The verified badge is now on your public profile, and buyers can see it on every listing.`) +
      h2('Get your first sale') +
      steps([
        `<b>Create a listing</b> with real screenshots and an honest description &mdash; disputes almost always start with a listing that overpromised.`,
        `<b>Stock it</b> with credentials so buyers get instant auto-delivery. Instant delivery converts far better than "message me".`,
        `<b>Set a withdraw address</b> in your portal so payouts have somewhere to go.`,
      ]) +
      note(`Every sale is escrowed: buyers pay the platform, you deliver, they confirm, then the money moves to your balance minus the platform fee. Nothing is charged on a refunded or cancelled deal.`, { tone: 'info', title: 'How you get paid' }) +
      button(sellerPortalUrl(), 'Open your seller portal'),
    bodyText:
      `An administrator has approved ${email || 'your account'} as a seller. The verified badge is now on your public profile.\n\n`
      + `Get your first sale:\n`
      + tSteps([
        'Create a listing with real screenshots and an honest description.',
        'Stock it with credentials so buyers get instant auto-delivery.',
        'Set a withdraw address in your portal so payouts have somewhere to go.',
      ])
      + `\n\nHow you get paid: buyers pay the platform, you deliver, they confirm, then the money moves to your balance minus the platform fee. Nothing is charged on a refunded or cancelled deal.\n\n`
      + `Seller portal: ${sellerPortalUrl()}`,
  });
}

function sellerRejectedEmail({ name, email, reason } = {}) {
  return shell({
    subject: `Your ${BRAND} seller access has been withdrawn`,
    title: 'Seller access withdrawn',
    preheader: 'Your seller verification has been removed. Your buyer account is unaffected.',
    bodyHtml:
      eyebrow('Seller access removed', 'danger') +
      h1('Seller access withdrawn') +
      lead(`${name ? esc(name) + ', a' : 'A'}n administrator has removed seller verification from <b>${esc(email || 'your account')}</b>. You can no longer create listings or open the seller portal.`) +
      (reason ? monoBox(reason, { label: 'Reason given' }) : '') +
      summary([
        ['Account', esc(email || '—')],
        ['Seller portal', 'No longer accessible'],
        ['Buyer account', 'Unaffected — you can still buy'],
        ['Existing escrows', 'Settled normally, not cancelled'],
      ], { title: 'What this changes' }) +
      p(`Any deal already in escrow still runs to completion: buyers confirm or dispute as usual, and a released payout still reaches your balance.`) +
      p(`If you think this was a mistake, reply to this email or raise it in an existing deal chat with an administrator.`),
    bodyText:
      `An administrator has removed seller verification from ${email || 'your account'}. You can no longer create listings or open the seller portal.\n\n`
      + (reason ? `Reason given:\n${reason}\n\n` : '')
      + tLine([
        ['Account', email || '—'],
        ['Seller portal', 'No longer accessible'],
        ['Buyer account', 'Unaffected — you can still buy'],
        ['Existing escrows', 'Settled normally, not cancelled'],
      ])
      + `\n\nAny deal already in escrow still runs to completion.\n\nIf you think this was a mistake, reply to this email.`,
  });
}

/* ---------- templates: money movement ---------- */

function withdrawalRequestedEmail({ amount, address, networkLabel, requestedAt, reference, balance } = {}) {
  return shell({
    subject: `Withdrawal requested — ${money(amount)}`,
    title: 'Withdrawal requested',
    preheader: `${money(amount)} is queued for payout. We will email you the transaction hash once it is sent.`,
    bodyHtml:
      eyebrow('Pending review', 'warn') +
      h1('Withdrawal requested') +
      lead(`We have queued your withdrawal. The amount has already been deducted from your available balance and is being held for payout &mdash; an administrator sends it on-chain manually.`) +
      amountHero(amount, { label: 'Withdrawal amount', tone: 'warn', note: balance != null ? `Remaining balance: ${esc(money(balance))}` : null }) +
      monoBox(address, { label: `Destination address${networkLabel ? ' \u00b7 ' + networkLabel : ''}` }) +
      summary([
        reference ? ['Reference', `<span style="font-family:${MONO};">${esc(reference)}</span>`] : null,
        ['Requested', esc(utcDate(requestedAt))],
        networkLabel ? ['Network', esc(networkLabel)] : null,
        ['Status', badge('Pending review', 'warn')],
      ], { title: 'Request' }) +
      note(`Check that address carefully. Payouts are on-chain and final &mdash; a transfer sent to a wrong or wrong-network address cannot be recovered by anyone, ${esc(BRAND)} included.`, { tone: 'danger', title: 'This address is where the money goes' }) +
      p(`If the request is rejected, the full amount is returned to your balance and you will get an email saying so.`) +
      button(sellerPortalUrl(), 'View your withdrawals'),
    bodyText:
      `We have queued your withdrawal. The amount is already deducted from your available balance and held for payout.\n\n`
      + `    Withdrawal amount: ${money(amount)}${balance != null ? `\n    Remaining balance: ${money(balance)}` : ''}\n    Destination: ${address}${networkLabel ? `\n    Network: ${networkLabel}` : ''}\n\n`
      + tLine([
        reference ? ['Reference', reference] : null,
        ['Requested', utcDate(requestedAt)],
        ['Status', 'Pending review'],
      ])
      + `\n\nCHECK THAT ADDRESS. Payouts are on-chain and final — a transfer to a wrong or wrong-network address cannot be recovered by anyone.\n\n`
      + `If the request is rejected, the full amount returns to your balance.\n\nYour withdrawals: ${sellerPortalUrl()}`,
  });
}

function withdrawalPaidEmail({ amount, address, networkLabel, txHash, paidAt, reference } = {}) {
  return shell({
    subject: `Sent — ${money(amount)} is on its way`,
    title: 'Withdrawal sent',
    preheader: `${money(amount)} has been sent on-chain${networkLabel ? ' via ' + networkLabel : ''}.`,
    bodyHtml:
      eyebrow('Payout sent', 'good') +
      h1('Your withdrawal is on-chain') +
      lead(`We have broadcast your payout. Once the network confirms it, the funds are in your wallet &mdash; nothing further is needed from us or from you.`) +
      amountHero(amount, { label: 'Sent', tone: 'good' }) +
      monoBox(txHash, { label: 'Transaction hash' }) +
      summary([
        ['Destination', `<span style="font-family:${MONO};font-size:12px;word-break:break-all;">${esc(address)}</span>`],
        networkLabel ? ['Network', esc(networkLabel)] : null,
        reference ? ['Reference', `<span style="font-family:${MONO};">${esc(reference)}</span>`] : null,
        ['Sent', esc(utcDate(paidAt))],
        ['Status', badge('Sent', 'good')],
      ], { title: 'Payout' }) +
      p(`Paste the transaction hash into any block explorer for ${esc(networkLabel || 'the network')} to watch it confirm.`),
    bodyText:
      `We have broadcast your payout. Once the network confirms, the funds are in your wallet.\n\n`
      + `    Sent: ${money(amount)}\n    Transaction: ${txHash}\n\n`
      + tLine([
        ['Destination', address],
        networkLabel ? ['Network', networkLabel] : null,
        reference ? ['Reference', reference] : null,
        ['Sent', utcDate(paidAt)],
      ])
      + `\n\nPaste the transaction hash into any block explorer for ${networkLabel || 'the network'} to watch it confirm.`,
  });
}

function withdrawalRejectedEmail({ amount, reason, rejectedAt, reference, balance } = {}) {
  return shell({
    subject: `Withdrawal rejected — ${money(amount)} returned to your balance`,
    title: 'Withdrawal rejected',
    preheader: `Your withdrawal was not sent. The full ${money(amount)} is back in your balance.`,
    bodyHtml:
      eyebrow('Not sent', 'danger') +
      h1('Withdrawal rejected') +
      lead(`An administrator did not approve this withdrawal, so nothing was sent on-chain. The <b>full amount has been returned</b> to your available balance.`) +
      amountHero(amount, { label: 'Returned to your balance', tone: 'good', note: balance != null ? `Balance now: ${esc(money(balance))}` : null }) +
      summary([
        reference ? ['Reference', `<span style="font-family:${MONO};">${esc(reference)}</span>`] : null,
        ['Rejected', esc(utcDate(rejectedAt))],
        reason ? ['Reason', esc(reason)] : null,
        ['Funds', 'Fully returned — nothing was sent'],
        ['Status', badge('Rejected', 'danger')],
      ], { title: 'Request' }) +
      p(`The most common cause is a destination address that does not match the withdrawal network. Check the address on your withdraw settings before requesting again.`) +
      button(sellerPortalUrl(), 'Check your withdraw address'),
    bodyText:
      `An administrator did not approve this withdrawal, so nothing was sent on-chain. The FULL amount has been returned to your available balance.\n\n`
      + `    Returned to your balance: ${money(amount)}${balance != null ? `\n    Balance now: ${money(balance)}` : ''}\n\n`
      + tLine([
        reference ? ['Reference', reference] : null,
        ['Rejected', utcDate(rejectedAt)],
        reason ? ['Reason', reason] : null,
        ['Funds', 'Fully returned — nothing was sent'],
      ])
      + `\n\nThe most common cause is a destination address that doesn't match the withdrawal network.\n\nWithdraw settings: ${sellerPortalUrl()}`,
  });
}

function walletToppedUpEmail({ amount, balance, networkLabel, txHash, creditedAt, orderId } = {}) {
  return shell({
    subject: `Wallet topped up — ${money(amount)} added`,
    title: 'Your wallet has been topped up',
    preheader: `${money(amount)} confirmed on-chain and credited to your Dot Wallet.`,
    bodyHtml:
      eyebrow('Deposit confirmed', 'good') +
      h1('Funds added to your wallet') +
      lead(`Your deposit confirmed on-chain and has been credited. Wallet balance buys instantly &mdash; no waiting for confirmations at checkout.`) +
      amountHero(amount, { label: 'Added to your wallet', tone: 'good', note: balance != null ? `New balance: ${esc(money(balance))}` : null }) +
      summary([
        orderId ? ['Deposit reference', `<span style="font-family:${MONO};">${esc(orderId)}</span>`] : null,
        networkLabel ? ['Network', esc(networkLabel)] : null,
        txHash ? ['Transaction', `<span style="font-family:${MONO};font-size:12px;word-break:break-all;">${esc(txHash)}</span>`] : null,
        ['Credited', esc(utcDate(creditedAt))],
        ['Status', badge('Confirmed', 'good')],
      ], { title: 'Deposit' }) +
      p(`Every purchase you make from this balance still goes through escrow &mdash; topping up does not skip the protection, it only skips the wait.`) +
      button(walletUrl(), 'Open your wallet'),
    bodyText:
      `Your deposit confirmed on-chain and has been credited. Wallet balance buys instantly — no waiting for confirmations at checkout.\n\n`
      + `    Added to your wallet: ${money(amount)}${balance != null ? `\n    New balance: ${money(balance)}` : ''}\n\n`
      + tLine([
        orderId ? ['Deposit reference', orderId] : null,
        networkLabel ? ['Network', networkLabel] : null,
        txHash ? ['Transaction', txHash] : null,
        ['Credited', utcDate(creditedAt)],
      ])
      + `\n\nEvery purchase from this balance still goes through escrow.\n\nOpen your wallet: ${walletUrl()}`,
  });
}

module.exports = {
  /* accounts */
  verificationEmail,
  welcomeEmail,
  sellerApprovedEmail,
  sellerRejectedEmail,
  /* buying */
  paymentInstructionsEmail,
  paymentConfirmedEmail,
  credentialEmail,
  orderDeliveredEmail,
  escrowReleasedBuyerEmail,
  refundEmail,
  /* disputes */
  disputeOpenedEmail,
  disputeResolvedEmail,
  /* selling */
  sellerSaleEmail,
  payoutReleasedEmail,
  /* money movement */
  withdrawalRequestedEmail,
  withdrawalPaidEmail,
  withdrawalRejectedEmail,
  walletToppedUpEmail,
  /* exported for tests and previews */
  _internals: { esc, money, coin, utcDate, shell, COLOR, BASE_URL },
};
