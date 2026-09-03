/* Portal access control: keep the seller & admin portals off the public site.
 *
 * Two independent layers (both can be combined):
 *
 *  1. Secret path — the portals are NOT served at the guessable /seller and
 *     /admin locations. They only answer at an unguessable prefix you configure
 *     (e.g. https://host/manage-x7k2q9/seller/). Requests to the old public
 *     paths return 404, so scanners and casual visitors can't even find the
 *     login page.
 *
 *  2. IP allowlist — optionally restrict the portals (and the claim link) to a
 *     set of client IPs / CIDR ranges (e.g. your office or VPN egress). When the
 *     allowlist is empty it is disabled.
 *
 * Config (env):
 *   PORTAL_SECRET_PATH   secret URL prefix, no leading slash. REQUIRED in
 *                        production; outside production a default is used and
 *                        printed at boot. Set PORTAL_DISABLE=true to serve the
 *                        portals at their legacy public paths instead.
 *   PORTAL_ALLOWED_IPS   comma-separated IPs or CIDRs (empty = no IP filter)
 *
 * Behind a reverse proxy, set TRUST_PROXY=true so req.ip reflects the real
 * client (X-Forwarded-For) for the IP allowlist.
 */

function parseIp(ip) {
  if (!ip) return null;
  let v = String(ip).trim().toLowerCase();
  if (v.startsWith('::ffff:')) v = v.slice(7); // IPv4-mapped IPv6
  return v || null;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = parseInt(p, 10);
    if (o > 255) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}

/* Minimal CIDR matcher (IPv4 + exact IPv6). */
function cidrMatcher(list) {
  const entries = list.map(parseCidr).filter(Boolean);
  return (rawIp) => {
    const ip = parseIp(rawIp);
    if (!ip) return false;
    return entries.some(e => e(ip));
  };
}

function parseCidr(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const [addr, bitsRaw] = s.split('/');
  const v4 = ipv4ToInt(addr);
  if (v4 != null) {
    const bits = bitsRaw == null ? 32 : parseInt(bitsRaw, 10);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    const base = (v4 & mask) >>> 0;
    return (ip) => {
      const n = ipv4ToInt(ip);
      return n != null && ((n & mask) >>> 0) === base;
    };
  }
  // IPv6: exact match only (CIDR for v6 is uncommon for an admin allowlist).
  const target = parseIp(addr);
  return (ip) => ip === target;
}

function buildConfig() {
  const disabled = process.env.PORTAL_DISABLE === 'true';
  const secret = (process.env.PORTAL_SECRET_PATH || '').trim().replace(/^\/+|\/+$/g, '');
  const isProd = process.env.NODE_ENV === 'production';
  /* PORTAL_DISABLE=true in production serves the admin/seller portals at
   * guessable public paths — refuse outright (boot error), honoring the spirit
   * of the production guard below. Outside production it's an explicit
   * convenience and is allowed (with a route-level warning). */
  const disableBlocked = disabled && isProd;
  const effectiveSecret = disabled ? '' : (secret || (isProd ? '' : 'manage-dev'));
  const allowed = (process.env.PORTAL_ALLOWED_IPS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return {
    disabled,
    disableBlocked,
    secret: effectiveSecret,
    secretConfigured: !!secret,
    isProd,
    ipAllowed: allowed.length ? cidrMatcher(allowed) : null,
    allowedCount: allowed.length,
  };
}

/**
 * Register the portal routes. Mounts the seller/admin apps at the secret path
 * (or their legacy public paths when disabled) and blocks the public paths with
 * a 404 when a secret path is active. Also exposes the secret-prefix middleware
 * used to guard the invite-claim API.
 */
function registerPortalAccess(app, { express, path, fs }) {
  const cfg = buildConfig();
  const pub = (...p) => path.join(__dirname, '..', 'public', ...p);

  // Fail fast in production if portals would be exposed at guessable paths —
  // either by an unset secret path or by an explicit PORTAL_DISABLE=true.
  if (cfg.disableBlocked) {
    throw new Error(
      'PORTAL_DISABLE=true is not allowed in production — it serves the admin/seller ' +
      'portals at the guessable public /seller and /admin paths. Set an unguessable ' +
      'PORTAL_SECRET_PATH (and optionally PORTAL_ALLOWED_IPS) instead.'
    );
  }
  if (!cfg.disabled && cfg.isProd && !cfg.secretConfigured) {
    throw new Error(
      'PORTAL_SECRET_PATH is required in production. The seller/admin portals ' +
      'must not be served at the public /seller and /admin paths. Set a long, ' +
      'unguessable PORTAL_SECRET_PATH (and optionally PORTAL_ALLOWED_IPS), or set ' +
      'PORTAL_DISABLE=true to explicitly serve them publicly.'
    );
  }

  function ipGuard(req, res, next) {
    if (!cfg.ipAllowed) return next();
    if (cfg.ipAllowed(req.ip || req.socket?.remoteAddress)) return next();
    return res.status(403).send('Forbidden');
  }

  const legacyPaths = ['/seller', '/admin'];

  if (cfg.disabled || !cfg.secret) {
    // Public portals at legacy paths (explicit opt-out). In production this is
    // almost certainly a mistake — the portals are admin/seller surfaces at
    // guessable paths. Warn on EVERY portal request, not just at boot.
    const prodWarn = (req, res, next) => {
      if (cfg.isProd) {
        console.warn('⚠ SECURITY: ' + req.path + ' portal is PUBLIC (PORTAL_DISABLE=true in production). Set PORTAL_SECRET_PATH instead.');
      }
      next();
    };
    app.use('/seller', prodWarn, ipGuard, express.static(pub('seller')));
    app.use('/admin', prodWarn, ipGuard, express.static(pub('admin')));
    return { ...cfg, mountBase: '', claimBase: '' };
  }

  // Secret-mounted portals. Block the guessable legacy paths entirely.
  for (const p of legacyPaths) {
    app.use(p, (req, res) => res.status(404).send('Not found'));
  }
  const base = '/' + cfg.secret;
  app.use(base + '/seller', ipGuard, express.static(pub('seller')));
  app.use(base + '/admin', ipGuard, express.static(pub('admin')));

  // Convenience redirect from the bare secret root to the seller portal.
  app.get(base, (req, res) => res.redirect(base + '/seller/'));

  return { ...cfg, mountBase: base, claimBase: base };
}

module.exports = { registerPortalAccess, buildConfig };
