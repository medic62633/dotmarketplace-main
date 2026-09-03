/* Outbound email via SMTP (Azure Communication Services ready, provider-agnostic).
 *
 * Config is entirely env-driven, so the same code works with ACS, SES, SendGrid's
 * SMTP relay, Mailgun SMTP, etc. For Azure Communication Services specifically:
 *   SMTP_HOST=smtp.azurecomm.net  SMTP_PORT=587  SMTP_SECURE=false (STARTTLS)
 *   SMTP_USER=<ResourceName>|<EntraAppId>|<TenantId>   (from ACS > SMTP Usernames)
 *   SMTP_PASS=<the Entra application's client secret>
 *   EMAIL_FROM=DoNotReply@<your-verified-domain>
 *
 * If SMTP_HOST is unset the mailer is disabled and every send is a logged no-op,
 * so the marketplace runs fine with no mail configured (local/dev).
 */
const nodemailer = require('nodemailer');

let _transporter = null;
let _init = false;

function bool(v, dflt) {
  if (v == null || v === '') return dflt;
  return /^(1|true|yes)$/i.test(String(v).trim());
}

function config() {
  const host = process.env.SMTP_HOST || '';
  const port = parseInt(process.env.SMTP_PORT || (bool(process.env.SMTP_SECURE, false) ? '465' : '587'), 10);
  return {
    enabled: !!host,
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: bool(process.env.SMTP_SECURE, false), // false => STARTTLS (587); true => implicit TLS (465)
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@dot.market',
  };
}

function getTransporter() {
  if (_init) return _transporter;
  _init = true;
  const c = config();
  if (!c.enabled) return null;
  _transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: !c.secure, // enforce STARTTLS on 587
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return _transporter;
}

function mailerEnabled() {
  return config().enabled;
}

/* Send one message. Returns { sent, skipped, error } — never throws. */
async function sendMail({ to, subject, text, html }) {
  const c = config();
  if (!c.enabled) {
    console.log('   mail (disabled) →', to, '·', subject);
    return { sent: false, skipped: true };
  }
  if (!to || !subject) return { sent: false, error: 'missing to/subject' };
  try {
    const t = getTransporter();
    await t.sendMail({ from: c.from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    // Email is best-effort; a provider hiccup must never fail a money request.
    console.error('   mail send error →', to, ':', err.message);
    return { sent: false, error: err.message };
  }
}

/* Fire-and-forget wrapper for request paths — logs, never rejects. */
function trySend(msg) {
  return sendMail(msg).catch(() => ({ sent: false }));
}

module.exports = { sendMail, trySend, mailerEnabled, config };
