require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CHAT_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'chat');
const MAX_CHAT_IMAGE_BYTES_PER_USER = 20 * 1024 * 1024; // 20 MB of chat images per account

function ensureChatUploadDir() {
  fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
}

const { parseImageDataUrl } = require('./lib/image-upload');
const { isId } = require('./lib/validate');
const { formatPayMethod } = require('./lib/payment-labels');
const { applySchemas } = require('./lib/schemas');

/* Orphaned (unprefixed) chat images predate owner prefixes and count toward NO
 * quota; spread their bytes across all owners so they can't be used to bypass
 * the per-user cap, and sweep them at boot (nothing references them). */
function orphanChatBytes() {
  let total = 0;
  try {
    for (const f of fs.readdirSync(CHAT_UPLOAD_DIR)) {
      if (f.includes('-')) continue;
      try { total += fs.statSync(path.join(CHAT_UPLOAD_DIR, f)).size; } catch (_) {}
    }
  } catch (_) {}
  return total;
}

let _chatOwnerCount = 1;
function setChatOwnerCount(n) {
  _chatOwnerCount = Math.max(1, Number(n) || 1);
}

function chatImageBytes(ownerKey) {
  let total = Math.ceil(orphanChatBytes() / _chatOwnerCount);
  try {
    for (const f of fs.readdirSync(CHAT_UPLOAD_DIR)) {
      if (!f.startsWith(ownerKey + '-')) continue;
      try { total += fs.statSync(path.join(CHAT_UPLOAD_DIR, f)).size; } catch (_) {}
    }
  } catch (_) {}
  return total;
}

/* Remove files no message references anymore (all unprefixed orphans, plus
 * files whose message vanished). Conservative: only deletes what's provably
 * unreferenced. Returns the number of files removed. */
function sweepChatImages(keepSet) {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(CHAT_UPLOAD_DIR)) {
      const isOrphan = !f.includes('-');
      const referenced = keepSet && keepSet.has(f);
      if (isOrphan || !referenced) {
        try { fs.unlinkSync(path.join(CHAT_UPLOAD_DIR, f)); removed++; } catch (_) {}
      }
    }
  } catch (_) {}
  return removed;
}

/* Delete one chat image by URL (path-traversal guarded). */
function deleteChatImage(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/chat/')) return;
  const filename = path.basename(url);
  const target = path.join(CHAT_UPLOAD_DIR, filename);
  if (!target.startsWith(CHAT_UPLOAD_DIR + path.sep)) return;
  fs.rm(target, { force: true }, () => {});
}

function saveChatImage(dataUrl, ownerKey) {
  const { ext, buf } = parseImageDataUrl(dataUrl);
  if (ownerKey) {
    const used = chatImageBytes(ownerKey);
    if (used + buf.length > MAX_CHAT_IMAGE_BYTES_PER_USER) throw new Error('storage_limit');
  }
  const filename = (ownerKey ? ownerKey + '-' : '') + crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(CHAT_UPLOAD_DIR, filename), buf);
  return '/uploads/chat/' + filename;
}

/* ---------- security headers (no external dep) ---------- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Only meaningful over HTTPS (browsers ignore it on plain HTTP), so it's
  // safe to send unconditionally; local dev over http:// is unaffected.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CSP: self + inline styles + data: images/fonts. NO 'unsafe-inline' scripts —
  // session tokens live in localStorage, so one XSS would otherwise exfiltrate
  // every signed-in session. All SPA scripts are external files. font-src allows
  // 'self' + data: because the site's webfonts are self-hosted as base64 @font-face
  // data URIs (public/css/fonts.css) — no third-party font host is ever contacted.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
  );
  next();
});

/* ---------- lightweight rate limiting (no external dep) ---------- */
const _rateBuckets = new Map(); // key -> { count, reset }
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = (keyFn ? keyFn(req) : req.ip) + '|' + req.path;
    let b = _rateBuckets.get(key);
    if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; _rateBuckets.set(key, b); }
    b.count += 1;
    if (_rateBuckets.size > 10000) {
      // crude eviction to bound memory
      for (const [k, v] of _rateBuckets) if (now > v.reset) _rateBuckets.delete(k);
    }
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000));
      return res.status(429).json({ error: 'rate_limited', msg: 'Too many requests — slow down' });
    }
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });      // signin/signup brute-force
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });          // messages / state writes
const paymentLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });        // payment / topup creation
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });          // anonymous public reads (listings, seller directory)

/* ---------- #13 request-ID + structured request logging ---------- */
app.use((req, res, next) => {
  req.id = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (req.path.startsWith('/api/')) {
      console.log(JSON.stringify({ t: new Date().toISOString(), id: req.id, m: req.method, p: req.path, s: res.statusCode, ms: Math.round(ms) }));
    }
  });
  next();
});

app.use(express.json({
  limit: '8mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

/* ---------- #13 liveness / readiness probe ----------
 * Previously this only checked `mongoClient` truthiness — set once at boot
 * and never cleared, so it reported db:'mongo', ok:true forever even after
 * the connection actually dropped mid-session. It's now an ACTIVE probe: a
 * short-timeout ping against the real connection, so a monitor polling this
 * (uptime check, PM2, a cron alert) actually finds out when Mongo is down
 * instead of everything looking fine right up until a request fails. */
app.get('/healthz', async (req, res) => {
  if (memory) {
    // Working, but explicitly flagged: this is the non-durable dev store —
    // a monitor should treat this as a warning if seen in production.
    return res.status(200).json({ ok: true, db: 'memory', durable: false, uptime: Math.round(process.uptime()), ts: Date.now() });
  }
  if (!mongoClient) {
    return res.status(503).json({ ok: false, db: 'down', uptime: Math.round(process.uptime()), ts: Date.now() });
  }
  try {
    await mongoClient.db('dotmarket').command({ ping: 1 }, { timeoutMS: 4000 });
    res.status(200).json({ ok: true, db: 'mongo', durable: true, uptime: Math.round(process.uptime()), ts: Date.now() });
  } catch (err) {
    console.error('⚠ /healthz: MongoDB ping failed —', err.message);
    res.status(503).json({ ok: false, db: 'mongo', durable: true, error: err.message, uptime: Math.round(process.uptime()), ts: Date.now() });
  }
});

// Behind a reverse proxy, honor X-Forwarded-For so the portal IP allowlist and
// rate limiting see the real client IP. Enable explicitly via TRUST_PROXY=true.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true);

/* ---------- invite-only seller/admin portals (secret path + IP allowlist) ----------
 * The portals are NOT served at the public /seller and /admin paths. They only
 * answer at the unguessable PORTAL_SECRET_PATH prefix (see lib/portal-access).
 * Registered before the public static middleware so the guards take precedence. */
const { registerPortalAccess } = require('./lib/portal-access');
const portalAccess = registerPortalAccess(app, { express, path, fs });

/* Chat images: auth + participant-checked serving. The URL alone is no longer
 * enough — a leaked link (screenshot, referrer header, log) is useless to a
 * non-participant. Filenames stay unguessable as a second layer.
 * Registered BEFORE express.static: the static middleware would otherwise
 * answer (or 404) these paths first and this guard would be dead code. */
app.get('/uploads/chat/:file', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).end('unauthorized');
    const filename = String(req.params.file || '');
    if (!/^[A-Za-z0-9-]+\.(jpg|jpeg|png|gif|webp)$/i.test(filename) || filename.includes('..')) {
      return res.status(400).end('bad request');
    }
    const url = '/uploads/chat/' + filename;
    let authorized = false;
    if (memory) {
      for (const [cid, list] of memory.messages.entries()) {
        if (list.some(m => m.image === url)) {
          const conv = memory.conversations.get(cid);
          authorized = !!conv && conv.participants.includes(user._id);
          break;
        }
      }
    } else {
      const msg = await messagesCol.findOne({ image: url }, { projection: { conversationId: 1 } });
      if (msg) {
        const conv = await conversationsCol.findOne({ _id: msg.conversationId, participants: user._id }, { projection: { _id: 1 } });
        authorized = !!conv;
      }
    }
    if (!authorized) return res.status(404).end('not found');
    res.sendFile(path.join(CHAT_UPLOAD_DIR, filename), err => {
      if (err && !res.headersSent) res.status(err.statusCode || 404).end('not found');
    });
  } catch (err) {
    res.status(500).end('server');
  }
});

app.use(express.static('public'));

/* ---------- storage layer: MongoDB when configured, in-memory dev store otherwise ---------- */
let mongoClient, usersCol, statesCol, conversationsCol, messagesCol, listingsCol, sellerProfilesCol, withdrawalsCol, paymentsCol, escrowsCol, walletsCol, reviewsCol, invitesCol, stockCol, verificationsCol, memory = null;
// Whether the connected Mongo can run multi-document transactions (a replica
// set — Atlas always is; a bare `docker run mongo` standalone is not).
// Detected once at boot; money-path stores fall back to their pre-transaction
// sequential-writes behavior when this is false, so a standalone deployment
// sees no behavior change from before transactions existed here.
let txnSupported = false;
// Tracks whether the last MongoDB server heartbeat failed, so a recovery is
// logged exactly once instead of on every successful heartbeat (~every 10s).
let dbHeartbeatDown = false;

// Demo-only auth shortcut (passwordless seller inbox login). Off by default —
// must be explicitly enabled for local demos.
const DEMO_AUTH = process.env.DEMO_AUTH === 'true';

// Session tokens are bearer credentials with no other revocation mechanism,
// so a leaked one must not stay valid forever. Existing sessions from before
// this field existed (no tokenIssuedAt) are left unexpired rather than mass
// logged-out by the deploy — they age out naturally on next signin.
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_DAYS) > 0 ? Number(process.env.SESSION_TTL_DAYS) : 30) * 24 * 60 * 60 * 1000;

/* Dev convenience: allow surfacing verification codes in API responses when a
 * mail send can't be delivered (e.g. Resend test domain only reaches the
 * registered address). NEVER enabled in production — that would leak codes. */
function allowDevCode() {
  return process.env.NODE_ENV !== 'production';
}

function isAtlasTlsBlock(err) {
  const msg = String(err?.message || err);
  return msg.includes('tlsv1 alert internal error') || msg.includes('SSL alert number 80');
}

/* ---------- #14 boot-time env validation ----------
 * Fail fast with a clear, actionable list instead of booting half-configured.
 * Only hard-requires secrets when we're not in an explicit local/demo mode. */
function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const problems = [];
  const warnings = [];

  if (!process.env.MONGODB_URI && !allowMemoryStore()) {
    problems.push('MONGODB_URI is required (in-memory store is disabled here).');
  }
  if (isProd) {
    if (process.env.DEMO_AUTH === 'true') problems.push('DEMO_AUTH=true is not allowed in production.');
    if (process.env.ALLOW_MEMORY_STORE === 'true') {
      problems.push('ALLOW_MEMORY_STORE=true is not allowed in production — it runs on a volatile in-memory store that loses all wallets/escrows/payments on every restart. Remove it; a real MongoDB connection failure should fail boot loudly, not silently degrade to memory.');
    }
    if (!process.env.ADMIN_PASSWORD) {
      problems.push('ADMIN_PASSWORD is required in production — the bootstrap admin defaults to the world-known "test12345".');
    }
    if (!process.env.PUBLIC_URL || /localhost|127\.0\.0\.1/.test(process.env.PUBLIC_URL)) {
      warnings.push('PUBLIC_URL should be the public https origin in production.');
    }
    if (process.env.OXAPAY_SANDBOX !== 'false') warnings.push('OXAPAY_SANDBOX should be "false" for live payments.');
    if (!process.env.STOCK_SECRET) {
      problems.push('STOCK_SECRET is required in production to encrypt credential stock at rest.');
    }
  }
  if (process.env.TRUST_PROXY === 'true') {
    warnings.push('TRUST_PROXY=true — ensure your reverse proxy overwrites X-Forwarded-For, otherwise IP allowlists and rate limiting can be spoofed.');
  }
  if (process.env.PAYMENT_PROVIDER !== 'cryptomus' && !process.env.OXAPAY_MERCHANT_API_KEY && !process.env.OXAPAY_API_KEY) {
    warnings.push('No OxaPay key — crypto checkout disabled (wallet-only mode).');
  }
  if (warnings.length) warnings.forEach(w => console.warn('   ⚠ config: ' + w));
  if (problems.length) {
    throw new Error('Invalid configuration:\n  - ' + problems.join('\n  - '));
  }
}

async function fetchPublicIp() {
  const https = require('https');
  return new Promise((resolve) => {
    https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.trim() || null));
    }).on('error', () => resolve(null));
  });
}

// In-memory fallback is fine for local hacking, but catastrophic in a real
// deploy (wallets/escrows/payments vanish on restart) — including the
// *silent* fallback on a transient MONGODB_URI connect failure below.
// NODE_ENV=production is checked FIRST and always wins, even over an
// explicit ALLOW_MEMORY_STORE=true: that flag is a local-dev convenience
// (see README), not a production override, and a leftover
// ALLOW_MEMORY_STORE=true from an old debug session must never let a
// production deploy quietly run — and lose data — on volatile memory
// instead of refusing to boot. (validateEnv() also hard-blocks this
// combination with a clear error, so it's caught before this function
// is even consulted for that reason — this ordering is the second layer.)
function allowMemoryStore() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.ALLOW_MEMORY_STORE === 'true') return true;
  const url = process.env.PUBLIC_URL || '';
  if (url && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\/?$/i.test(url)) return false;
  return true;
}

/* ---------- #12 DB indexes on hot query fields ---------- */
async function ensureIndexes() {
  const safe = (col, spec, opts) => col.createIndex(spec, opts).catch(e => console.warn('   index warn:', e.message));
  /* Unique indexes that guard MONEY invariants must exist — if they can't be
   * built (e.g. pre-existing duplicate orderIds), booting without them would
   * let duplicate payment records defeat claimPaid's atomic guard. Fail boot. */
  const critical = async (col, spec, opts, label) => {
    try {
      await col.createIndex(spec, opts);
    } catch (e) {
      throw new Error(
        `Required unique index on ${label} could not be created: ${e.message}. ` +
        'Resolve the duplicate/invalid documents and restart — refusing to run ' +
        'without this money-guarding constraint.'
      );
    }
  };
  await critical(paymentsCol, { orderId: 1 }, { unique: true, sparse: true }, 'payments.orderId');
  await critical(invitesCol, { tokenHash: 1 }, { unique: true, sparse: true }, 'invites.tokenHash');
  await Promise.all([
    safe(usersCol, { token: 1 }, { sparse: true }),
    safe(paymentsCol, { buyerEmail: 1, createdAt: -1 }),
    safe(paymentsCol, { sellerEmail: 1, createdAt: -1 }),
    safe(listingsCol, { status: 1, createdAt: -1 }),
    safe(listingsCol, { sellerEmail: 1, status: 1 }),
    safe(messagesCol, { conversationId: 1, createdAt: 1 }),
    safe(conversationsCol, { participants: 1, lastMessageAt: -1 }),
    safe(withdrawalsCol, { sellerEmail: 1, createdAt: -1 }),
    safe(withdrawalsCol, { status: 1 }),
    safe(reviewsCol, { sellerEmail: 1, createdAt: -1 }),
    safe(escrowsCol, { sellerEmail: 1, status: 1 }),
    safe(invitesCol, { email: 1, status: 1 }),
    // Auto-purge expired invites so the collection doesn't grow unbounded.
    safe(invitesCol, { expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Credential stock: fast available-unit claim per listing+variant, and
    // order lookup. reserveOne/countAvailable always filter on all three
    // fields together (a listing's variants each keep a separate pool), so
    // the compound index needs variantId in it too, not just listingId+status.
    safe(stockCol, { listingId: 1, variantId: 1, status: 1 }),
    // Auto-purge expired verification codes.
    safe(verificationsCol, { expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Admin/reconciliation views filter payments by status.
    safe(paymentsCol, { status: 1, createdAt: -1 }),
  ]);
  // A stock unit's orderId is its one-buyer invariant: at most one unit may
  // point at a given order. Unique + a partial filter (rather than plain
  // sparse) — every doc has an `orderId` field, usually `null` while
  // available, and a sparse index still indexes explicit nulls, so a plain
  // unique+sparse index would allow only one available (orderId: null) unit
  // in the whole collection. Best-effort like the other non-critical
  // indexes above (not `critical`): unlike payments.orderId/invites.tokenHash,
  // this isn't the app's only defense against a double-claim (reserveOne's
  // conditional findOneAndUpdate already is), so if it can't be built because
  // pre-existing data has a duplicate, warn instead of blocking boot.
  await safe(
    stockCol,
    { orderId: 1 },
    { unique: true, partialFilterExpression: { orderId: { $type: 'string' } } }
  );
  await applySchemas(mongoClient.db('dotmarket'));
}

/* Retry the initial Mongo connection with backoff before giving up. A
 * transient Atlas hiccup at boot (brief network blip, a primary election
 * during failover/maintenance) can outlast a single connect attempt even
 * with a generous 30s timeout — without a retry here, that one unlucky
 * moment at process start is what silently tips a misconfigured production
 * deploy into the in-memory fallback (or, correctly configured, crashes it
 * needlessly). Not attempted for errors a retry can never fix (e.g. bad
 * auth) — but distinguishing those reliably from real transients isn't
 * worth the complexity here, so every failure gets the same bounded retry;
 * worst case that costs ~60s of extra boot time once, not a data-loss risk. */
async function connectWithRetry(client) {
  const delaysMs = [2000, 4000, 8000, 16000, 30000];
  for (let attempt = 0; ; attempt++) {
    try {
      await client.connect();
      return;
    } catch (err) {
      if (attempt >= delaysMs.length) throw err;
      const wait = delaysMs[attempt];
      console.warn(`   MongoDB connect attempt ${attempt + 1}/${delaysMs.length + 1} failed (${err.message.split('\n')[0]}) — retrying in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    if (!allowMemoryStore()) {
      throw new Error('MONGODB_URI is not set and the in-memory store is disabled in this environment. Set MONGODB_URI, or ALLOW_MEMORY_STORE=true for local dev.');
    }
    memory = { users: new Map(), states: new Map(), conversations: new Map(), messages: new Map(), listings: new Map(), sellerProfiles: new Map(), withdrawals: new Map(), payments: new Map(), escrows: new Map(), wallets: new Map(), reviews: new Map(), invites: new Map(), stock: new Map(), verifications: new Map() };
    console.log('⚠  MONGODB_URI not set — running on in-memory store (data lost on restart).');
    console.log('   Create .env with MONGODB_URI=mongodb://127.0.0.1:27017/dotmarket (local) or mongodb+srv://... (Atlas).');
    return;
  }
  const { MongoClient } = require('mongodb');
  // Atlas over this network has a slow TLS handshake (~5-6s, sometimes more);
  // 10s was too tight and caused intermittent "secureConnect timed out" failures.
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });
  try {
    await connectWithRetry(client);
    const db = client.db('dotmarket');
    usersCol = db.collection('users');
    statesCol = db.collection('states');
    conversationsCol = db.collection('conversations');
    messagesCol = db.collection('messages');
    listingsCol = db.collection('listings');
    sellerProfilesCol = db.collection('seller_profiles');
    withdrawalsCol = db.collection('withdrawals');
    paymentsCol = db.collection('payments');
    escrowsCol = db.collection('escrows');
    walletsCol = db.collection('wallets');
    reviewsCol = db.collection('reviews');
    invitesCol = db.collection('invites');
    stockCol = db.collection('stock');
    verificationsCol = db.collection('email_verifications');
    mongoClient = client;
    // The driver reconnects on its own and existing operations already
    // retry (retryWrites/retryReads in the URI) — this is purely visibility:
    // previously a mid-session Mongo outage was invisible until a request
    // happened to fail and someone noticed. Now it's in the logs the moment
    // it starts, and again the moment it clears, independent of traffic.
    client.on('serverHeartbeatFailed', (event) => {
      dbHeartbeatDown = true;
      console.error(`⚠ MongoDB heartbeat failed (${event.connectionId}): ${event.failure?.message || event.failure}`);
    });
    client.on('serverHeartbeatSucceeded', () => {
      if (dbHeartbeatDown) {
        dbHeartbeatDown = false;
        console.log('✓ MongoDB heartbeat recovered');
      }
    });
    client.on('close', () => {
      console.error('⚠ MongoDB connection closed.');
    });
    const host = uri.startsWith('mongodb+srv://') ? 'MongoDB Atlas' : uri.replace(/\/\/([^@]+@)?/, '//');
    console.log('✓ Connected to MongoDB (' + host + ')');
    // Multi-document transactions need a replica set (Atlas always is one; a
    // bare `docker run mongo` standalone isn't). `hello` reports `setName`
    // only when the node is part of one — a safe, read-only, no-privilege
    // check to run once at boot rather than probing with a real transaction.
    try {
      const hello = await db.admin().command({ hello: 1 });
      txnSupported = !!hello.setName;
    } catch (_) {
      txnSupported = false;
    }
    console.log('   Transactions: ' + (txnSupported ? 'supported (replica set)' : 'not supported (standalone) — money-path writes stay sequential'));
    await ensureIndexes();
  } catch (err) {
    try { await client.close(); } catch (_) {}
    console.error('⚠  MongoDB connection failed.');
    console.error('   ' + err.message.split('\n')[0]);
    if (uri.startsWith('mongodb+srv://') && isAtlasTlsBlock(err)) {
      const ip = await fetchPublicIp();
      console.error('   Atlas TLS blocked — add your IP under Network Access in MongoDB Atlas.');
      if (ip) console.error('   Your public IP: ' + ip);
      console.error('   Local dev: docker compose up -d  then MONGODB_URI=mongodb://127.0.0.1:27017/dotmarket');
    }
    if (!allowMemoryStore()) {
      throw new Error('MongoDB connection failed and the in-memory fallback is disabled in this environment. Refusing to start with ephemeral money state.');
    }
    memory = { users: new Map(), states: new Map(), conversations: new Map(), messages: new Map(), listings: new Map(), sellerProfiles: new Map(), withdrawals: new Map(), payments: new Map(), escrows: new Map(), wallets: new Map(), reviews: new Map(), invites: new Map(), stock: new Map(), verifications: new Map() };
    console.error('   Falling back to in-memory store (local/dev only — data lost on restart).');
  }
}

const store = {
  async getUser(email) {
    return memory ? memory.users.get(email) || null : usersCol.findOne({ _id: email });
  },
  async putUser(user) {
    if (memory) memory.users.set(user._id, user);
    else await usersCol.replaceOne({ _id: user._id }, user, { upsert: true });
  },
  async getState(email) {
    if (memory) return memory.states.get(email) || null;
    const doc = await statesCol.findOne({ _id: email });
    return doc ? doc.state : null;
  },
  async putState(email, state) {
    if (memory) memory.states.set(email, state);
    else await statesCol.replaceOne({ _id: email }, { _id: email, state, updatedAt: new Date() }, { upsert: true });
  },
  async deleteState(email) {
    if (memory) memory.states.delete(email);
    else await statesCol.deleteOne({ _id: email });
  },
};

const { createSellerStore } = require('./lib/seller-store');
const { registerSellerRoutes, userPayload } = require('./lib/seller-routes');
const { createWalletStore } = require('./lib/wallet-store');
const { registerWalletRoutes } = require('./lib/wallet-routes');
const { createPaymentStore } = require('./lib/payment-store');
const { registerPaymentRoutes } = require('./lib/payment-routes');
const { registerAdminRoutes } = require('./lib/admin-routes');
const { createInviteStore } = require('./lib/invite-store');
const { createStockStore } = require('./lib/stock-store');
const { registerStockRoutes } = require('./lib/stock-routes');
const { createVerificationStore } = require('./lib/verification-store');
const { autoDeliver } = require('./lib/stock-deliver');
const mailer = require('./lib/mailer');
const templates = require('./lib/email-templates');
const notify = require('./lib/order-notify');
const { ensureListingUploadDir } = require('./lib/image-upload');
const payments = require('./lib/payments');

let sellerStore;
let paymentStore;
let walletStore;
let inviteStore;
let stockStore;
let verificationStore;

async function sellerProfileFor(user) {
  if (!user?.isSeller) return null;
  if (!sellerStore) return null;
  const p = await sellerStore.getSellerProfile(user._id);
  return sellerStore.serializeSellerProfile(p);
}

const hash = (pass, salt) =>
  crypto.scryptSync(pass, salt, 32).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return false;
  }
}

function tokenExpired(user) {
  if (!user?.tokenIssuedAt) return false; // pre-expiry session — see SESSION_TTL_MS comment
  return Date.now() - new Date(user.tokenIssuedAt).getTime() > SESSION_TTL_MS;
}

async function authUser(req) {
  const raw = req.headers.authorization || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  let user;
  if (memory) {
    user = null;
    for (const u of memory.users.values()) if (u.token === token) { user = u; break; }
  } else {
    user = await usersCol.findOne({ token });
  }
  if (!user || tokenExpired(user)) return null;
  return user;
}

function sellerEmailFromName(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return (slug || 'seller') + '@sellers.dot.market';
}

function conversationId({ dealId, buyerEmail, sellerEmail, sellerName }) {
  if (dealId) return 'deal:' + dealId;
  // Key DM threads on the canonical seller email so names that slugify the same
  // (e.g. "Anna Pixel" vs "anna.pixel") don't collapse into one conversation.
  const seller = sellerEmail || sellerEmailFromName(sellerName);
  return `dm:${buyerEmail}:${seller}`;
}

/* Whitelisted system-message templates. The client sends { kind, ...params };
 * the server renders the text, so nobody can inject fake "payment confirmed"
 * lines into a deal chat. Amounts are formatted server-side from numbers. */
const SYS_AMT = n => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0 || v > 1e9) return null;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function renderSystemText(body) {
  const kind = String(body.kind || '');
  if (kind === 'deal_created') {
    if (!isId(body.dealId)) return null;
    const amt = SYS_AMT(body.amt);
    return amt ? `Deal ${body.dealId} created · ${amt} USDT` : null;
  }
  if (kind === 'escrow_held') {
    const amt = SYS_AMT(body.amt);
    const label = formatPayMethod({ method: String(body.method || '') });
    if (!amt || !label || label === '—') return null;
    return `Payment held in escrow · ${amt} USDT via ${label}`;
  }
  if (kind === 'released') {
    return 'Delivery confirmed — funds released to the seller';
  }
  if (kind === 'dispute_opened') {
    const reason = String(body.reason || '').trim().slice(0, 300);
    return reason ? `Buyer opened a dispute: ${reason}` : null;
  }
  return null;
}

function participantRole(email, conv) {
  if (email === conv.buyerEmail) return 'buyer';
  if (email === conv.sellerEmail) return 'seller';
  return null;
}

function counterpartyFor(email, conv) {
  if (email === conv.buyerEmail) return { name: conv.sellerName, role: 'Seller' };
  if (email === conv.sellerEmail) return { name: conv.buyerName || conv.buyerEmail.split('@')[0], role: 'Buyer' };
  return { name: 'Unknown', role: 'User' };
}

function formatMsgTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  if (dt.toDateString() === now.toDateString()) {
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return dt.toLocaleDateString([], { weekday: 'short' });
}

async function getConversation(id) {
  if (memory) return memory.conversations.get(id) || null;
  return conversationsCol.findOne({ _id: id });
}

async function saveConversation(conv) {
  if (memory) {
    memory.conversations.set(conv._id, conv);
    return;
  }
  await conversationsCol.replaceOne({ _id: conv._id }, conv, { upsert: true });
}

async function listConversationsFor(email) {
  const filter = { participants: email };
  if (memory) {
    return [...memory.conversations.values()]
      .filter(c => c.participants.includes(email))
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }
  return conversationsCol.find(filter).sort({ lastMessageAt: -1 }).limit(100).toArray();
}

async function getMessages(conversationId, since) {
  if (memory) {
    const list = memory.messages.get(conversationId) || [];
    if (!since) return list;
    const t = new Date(since).getTime();
    return list.filter(m => new Date(m.createdAt).getTime() > t);
  }
  const q = { conversationId };
  if (since) q.createdAt = { $gt: new Date(since) };
  return messagesCol.find(q).sort({ createdAt: 1 }).limit(500).toArray();
}

async function appendMessage(conversationId, msg) {
  const doc = {
    _id: crypto.randomBytes(12).toString('hex'),
    conversationId,
    senderEmail: msg.senderEmail,
    type: msg.type || 'user',
    text: String(msg.text || '').slice(0, 4000),
    image: msg.image || null,
    createdAt: new Date(),
  };
  if (memory) {
    if (!memory.messages.has(conversationId)) memory.messages.set(conversationId, []);
    memory.messages.get(conversationId).push(doc);
  } else {
    await messagesCol.insertOne(doc);
  }
  return doc;
}

async function ensureSellerUser(sellerName, email) {
  email = email || sellerEmailFromName(sellerName);
  // Only auto-provision the name-derived placeholder sellers used by the demo.
  // A caller-supplied "real" email must belong to an existing account — we must
  // never mint a fresh seller identity (with a live token) for an arbitrary
  // address, or anyone could create (and, via DEMO_AUTH, log into) fake sellers.
  const isPlaceholder = email.endsWith('@sellers.dot.market');
  let user = await store.getUser(email);
  if (!user && isPlaceholder) {
    user = {
      _id: email,
      name: sellerName,
      passHash: '',
      salt: '',
      token: newToken(),
      tokenIssuedAt: new Date(),
      isSeller: true,
      createdAt: new Date(),
    };
    await store.putUser(user);
  }
  return user || null;
}

function serializeConversation(conv, viewerEmail) {
  const cp = counterpartyFor(viewerEmail, conv);
  const unread = viewerEmail === conv.buyerEmail ? conv.buyerUnread : conv.sellerUnread;
  return {
    id: conv._id,
    dealId: conv.dealId || null,
    listingId: conv.listingId || null,
    who: cp.name,
    role: cp.role,
    title: conv.title || '',
    unread: unread || 0,
    lastPreview: conv.lastPreview || '',
    lastMessageAt: conv.lastMessageAt,
  };
}

function serializeMessage(msg, viewerEmail) {
  if (msg.type === 'system') {
    return { sys: msg.text, t: formatMsgTime(msg.createdAt), at: msg.createdAt };
  }
  const out = {
    from: msg.senderEmail === viewerEmail ? 'me' : 'them',
    text: msg.text || '',
    t: formatMsgTime(msg.createdAt),
    at: msg.createdAt,
    sender: msg.senderEmail,
  };
  if (msg.image) out.image = msg.image;
  return out;
}

/* ---------- routes ---------- */
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'name', msg: 'At least 2 characters' });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email', msg: 'Enter a valid email address' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'password', msg: 'At least 8 characters' });
    const id = email.toLowerCase();
    if (await store.getUser(id)) return res.status(409).json({ error: 'email', msg: 'Account exists — sign in instead' });
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { _id: id, name: name.trim(), passHash: hash(password, salt), salt, token: newToken(), tokenIssuedAt: new Date(), createdAt: new Date() };
    await store.putUser(user);
    const seller = await sellerProfileFor(user);
    // Issue a 6-digit verification code and email it. Soft enforcement: the
    // account is signed in immediately; verifying just sets the verified flag.
    let needsVerification = false;
    let mailConfigured = mailer.mailerEnabled();
    try {
      const issued = await verificationStore.issue(id, { force: true });
      if (issued.code) {
        needsVerification = true;
        const minutes = Math.round(verificationStore.CODE_TTL_MS / 60000);
        const r = await mailer.sendMail({
          to: id,
          subject: `${issued.code} — your Dot Marketplace code`,
          ...templates.verificationEmail({ name: user.name, code: issued.code, minutes }),
        });
        if (!r.sent && !r.skipped) mailConfigured = false;
        // Dev convenience: surface the code when SMTP isn't configured OR the
        // send failed (e.g. Resend test domain only delivers to the registered
        // address), so any signup email is verifiable on localhost. Prod-safe:
        // never leaks the code when running under NODE_ENV=production.
        const devCode = allowDevCode() && !r.sent ? issued.code : undefined;
        return res.json({ token: user.token, user: userPayload(user, seller), needsVerification, email: id, mailConfigured, devCode });
      }
    } catch (err) {
      console.error('verification issue error:', err.message);
    }
    res.json({ token: user.token, user: userPayload(user, seller), needsVerification, mailConfigured });
  } catch (err) {
    console.error('signup error:', err.message);
    res.status(500).json({ error: 'server', msg: 'Could not create account' });
  }
});

/* Verify the 6-digit signup code. Marks the user verified (soft enforcement —
 * they can use the account either way, but this confirms the email is real). */
app.post('/api/auth/verify-email', authLimiter, async (req, res) => {
  try {
    const { email, code } = req.body || {};
    const id = (email || '').toLowerCase().trim();
    if (!id || !code) return res.status(400).json({ error: 'bad request', msg: 'Email and code are required' });
    const result = await verificationStore.verify(id, String(code).trim());
    if (result.verified) {
      const user = await store.getUser(id);
      if (user && !user.emailVerified) { user.emailVerified = true; await store.putUser(user); }
      return res.json({ ok: true, verified: true, already: !!result.already });
    }
    if (result.expired) return res.status(410).json({ error: 'expired', msg: 'Code expired — request a new one' });
    if (result.locked) return res.status(429).json({ error: 'locked', msg: 'Too many wrong tries — request a new code' });
    if (result.mismatch) return res.status(400).json({ error: 'mismatch', msg: `Incorrect code (${result.attemptsLeft} tries left)` });
    return res.status(404).json({ error: 'invalid', msg: 'No verification code for this email — sign up first' });
  } catch (err) {
    console.error('verify-email error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

/* Resend a verification code (cooldown-limited). */
app.post('/api/auth/resend-code', authLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const id = (email || '').toLowerCase().trim();
    if (!id) return res.status(400).json({ error: 'bad request', msg: 'Email required' });
    const user = await store.getUser(id);
    // Unknown email → same success shape, no code issued. A 404 here would let
    // anyone probe which addresses hold accounts.
    if (!user) return res.json({ ok: true });
    const issued = await verificationStore.issue(id);
    if (issued.cooldown) {
      return res.status(429).json({ error: 'cooldown', msg: `Wait ${issued.cooldown}s before resending`, retryAfter: issued.cooldown });
    }
    const minutes = Math.round(verificationStore.CODE_TTL_MS / 60000);
    const r = await mailer.sendMail({
      to: id,
      subject: `${issued.code} — your Dot Marketplace code`,
      ...templates.verificationEmail({ name: user.name, code: issued.code, minutes }),
    });
    const devCode = allowDevCode() && !r.sent ? issued.code : undefined;
    res.json({ ok: true, devCode });
  } catch (err) {
    console.error('resend-code error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/auth/signin', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const id = (email || '').toLowerCase();
    const user = await store.getUser(id);
    if (user && DEMO_AUTH && user.isSeller && (!user.salt || !user.passHash)) {
      user.token = newToken();
      user.tokenIssuedAt = new Date();
      await store.putUser(user);
      const seller = await sellerProfileFor(user);
      return res.json({ token: user.token, user: userPayload(user, seller) });
    }
    // One generic failure for unknown email AND wrong password — distinct
    // responses let anyone enumerate registered accounts.
    if (!user || !user.salt || !user.passHash || !safeEqualHex(hash(password || '', user.salt), user.passHash))
      return res.status(401).json({ error: 'credentials', msg: 'Invalid email or password' });
    user.token = newToken();
    user.tokenIssuedAt = new Date();
    await store.putUser(user);
    const seller = await sellerProfileFor(user);
    res.json({ token: user.token, user: userPayload(user, seller) });
  } catch (err) {
    console.error('signin error:', err.message);
    res.status(500).json({ error: 'server', msg: 'Could not sign in' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const state = await store.getState(user._id);
    // Balance is server-authoritative — always report the wallet's number,
    // never whatever the client last stored.
    const balance = walletStore ? await walletStore.getBalance(user._id) : (state?.bal || 0);
    const merged = state
      ? { ...state, bal: balance }
      : { deals: [], bal: balance, txs: [] };
    res.json({ state: merged });
  } catch (err) {
    console.error('get state error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.put('/api/state', writeLimiter, async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const { state } = req.body || {};
    if (!state || typeof state !== 'object') return res.status(400).json({ error: 'bad state' });
    // Deals/txs are cosmetic client state we persist as-is. `bal` from the
    // client is ignored — the wallet store is the single source of truth.
    const balance = walletStore ? await walletStore.getBalance(user._id) : 0;
    await store.putState(user._id, {
      deals: Array.isArray(state.deals) ? state.deals.slice(0, 200) : [],
      bal: balance,
      txs: Array.isArray(state.txs) ? state.txs.slice(0, 300) : [],
    });
    res.json({ ok: true, bal: balance });
  } catch (err) {
    console.error('put state error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.delete('/api/state', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    await store.deleteState(user._id);
    if (walletStore) await walletStore.resetWallet(user._id);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete state error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

/* ---------- messaging: buyer ↔ seller ---------- */
app.get('/api/conversations', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const list = await listConversationsFor(user._id);
    res.json({ conversations: list.map(c => serializeConversation(c, user._id)) });
  } catch (err) {
    console.error('list conversations error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/conversations', writeLimiter, async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const { dealId, listingId, sellerName, sellerEmail: bodySellerEmail, title, buyerName } = req.body || {};
    if (!sellerName || String(sellerName).trim().length < 1) {
      return res.status(400).json({ error: 'sellerName', msg: 'Seller name required' });
    }
    const seller = String(sellerName).trim();
    // Prefer the listing's real seller account email so the thread is reachable
    // by the actual seller login (e.g. rockstar@gmail.com), not a name-derived
    // placeholder like rockstar@sellers.dot.market. Fall back to the derived
    // address only when no real email is supplied (legacy/demo sellers).
    const candidate = String(bodySellerEmail || '').trim().toLowerCase();
    const sellerEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate) ? candidate : sellerEmailFromName(seller);
    const sellerUser = await ensureSellerUser(seller, sellerEmail);
    if (!sellerUser) {
      return res.status(404).json({ error: 'seller', msg: 'Seller account not found' });
    }

    const buyerEmail = user._id;
    const id = conversationId({ dealId: dealId || null, buyerEmail, sellerEmail, sellerName: seller });
    let conv = await getConversation(id);

    if (!conv) {
      conv = {
        _id: id,
        dealId: dealId || null,
        listingId: listingId || null,
        title: String(title || '').slice(0, 200),
        buyerEmail,
        buyerName: buyerName || user.name,
        sellerName: seller,
        sellerEmail,
        participants: [buyerEmail, sellerEmail],
        buyerUnread: 0,
        sellerUnread: 0,
        lastPreview: '',
        lastMessageAt: new Date(),
        createdAt: new Date(),
      };
      await saveConversation(conv);
    } else {
      // Deal conversations key on the dealId alone, so a guessed id must NOT
      // leak the existing thread's metadata to a non-participant.
      if (!conv.participants.includes(user._id)) {
        return res.status(404).json({ error: 'not found' });
      }
      if (title && !conv.title) {
        conv.title = String(title).slice(0, 200);
        await saveConversation(conv);
      }
    }

    res.json({ conversation: serializeConversation(conv, user._id) });
  } catch (err) {
    console.error('create conversation error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const conv = await getConversation(req.params.id);
    if (!conv || !conv.participants.includes(user._id)) {
      return res.status(404).json({ error: 'not found' });
    }
    const since = req.query.since || null;
    const messages = since
      ? await getMessages(conv._id, since)
      : await getMessages(conv._id);
    res.json({ messages: messages.map(m => serializeMessage(m, user._id)) });
  } catch (err) {
    console.error('get messages error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/conversations/:id/messages', writeLimiter, async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const text = String((req.body || {}).text || '').trim();
    const imageData = (req.body || {}).image || null;
    if (!text && !imageData) return res.status(400).json({ error: 'text', msg: 'Message cannot be empty' });

    const conv = await getConversation(req.params.id);
    if (!conv || !conv.participants.includes(user._id)) {
      return res.status(404).json({ error: 'not found' });
    }

    let imageUrl = null;
    if (imageData) {
      try {
        ensureChatUploadDir();
        imageUrl = saveChatImage(imageData, user._id.replace(/[^a-z0-9]/gi, ''));
      } catch (err) {
        return res.status(400).json({
          error: 'image',
          msg: err.message === 'storage_limit'
            ? 'Image storage limit reached (20 MB) — remove old images'
            : 'Invalid or too large image (max 4 MB)',
        });
      }
    }

    const msg = await appendMessage(conv._id, { senderEmail: user._id, type: 'user', text, image: imageUrl });
    const preview = imageUrl
      ? (text ? `📷 ${text.length > 60 ? text.slice(0, 57) + '…' : text}` : '📷 Photo')
      : (text.length > 80 ? text.slice(0, 77) + '…' : text);
    conv.lastPreview = preview;
    conv.lastMessageAt = msg.createdAt;
    if (user._id === conv.buyerEmail) conv.sellerUnread = (conv.sellerUnread || 0) + 1;
    else conv.buyerUnread = (conv.buyerUnread || 0) + 1;
    await saveConversation(conv);

    res.json({ message: serializeMessage(msg, user._id) });
  } catch (err) {
    console.error('send message error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/conversations/:id/system', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const conv = await getConversation(req.params.id);
    if (!conv || !conv.participants.includes(user._id)) {
      return res.status(404).json({ error: 'not found' });
    }

    // Status lines are driven by the buyer's client (deal lifecycle updates).
    // A seller forging "refund processed" / "released" would be a
    // social-engineering vector against the buyer, so only the buyer may post.
    if (conv.buyerEmail !== user._id) {
      return res.status(403).json({ error: 'forbidden', msg: 'Only the buyer can post status messages' });
    }

    // Free-form system text is just as dangerous in the other direction — a
    // scammer buyer could inject "⚙ Payment confirmed" to talk a seller into
    // delivering for nothing. System messages are whitelisted templates the
    // server renders from validated params; arbitrary text is rejected.
    const text = renderSystemText(req.body || {});
    if (!text) return res.status(400).json({ error: 'text', msg: 'Unknown system message kind' });

    const msg = await appendMessage(conv._id, { senderEmail: 'system', type: 'system', text });
    conv.lastPreview = '⚙ ' + text;
    conv.lastMessageAt = msg.createdAt;
    await saveConversation(conv);

    res.json({ message: serializeMessage(msg, user._id) });
  } catch (err) {
    console.error('system message error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/conversations/:id/read', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const conv = await getConversation(req.params.id);
    if (!conv || !conv.participants.includes(user._id)) {
      return res.status(404).json({ error: 'not found' });
    }
    if (user._id === conv.buyerEmail) conv.buyerUnread = 0;
    else conv.sellerUnread = 0;
    await saveConversation(conv);
    res.json({ ok: true });
  } catch (err) {
    console.error('read conversation error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

/* Delete a conversation the caller participates in. Also removes its messages
 * and the chat image files they referenced — otherwise orphaned uploads would
 * live forever (and keep counting against a quota nobody can see). */
app.delete('/api/conversations/:id', writeLimiter, async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const conv = await getConversation(req.params.id);
    if (!conv || !conv.participants.includes(user._id)) {
      return res.status(404).json({ error: 'not found' });
    }
    const msgs = await getMessages(conv._id);
    for (const m of msgs) {
      if (m.image) deleteChatImage(m.image);
    }
    if (memory) {
      memory.messages.delete(conv._id);
      memory.conversations.delete(conv._id);
    } else {
      await messagesCol.deleteMany({ conversationId: conv._id });
      await conversationsCol.deleteOne({ _id: conv._id });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('delete conversation error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

async function ensureBootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@dot.market').toLowerCase();
  const existing = await store.getUser(email);
  if (existing) {
    if (!existing.isAdmin) {
      existing.isAdmin = true;
      await store.putUser(existing);
    }
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const adminPass = process.env.ADMIN_PASSWORD || 'test12345';
  await store.putUser({
    _id: email,
    name: 'Admin',
    passHash: hash(adminPass, salt),
    salt,
    token: newToken(),
    tokenIssuedAt: new Date(),
    isAdmin: true,
    createdAt: new Date(),
  });
  console.log('   Bootstrap admin: ' + email + (process.env.ADMIN_PASSWORD ? '' : ' / test12345 (set ADMIN_PASSWORD to override)'));
}

/* Claim a one-time seller invite: the new seller sets their password, the
 * account is created (verified seller) and a session is returned so they land
 * signed-in. The token is single-use and matched only by its SHA-256 hash. */
app.post('/api/seller-invite/claim', authLimiter, async (req, res) => {
  try {
    const { token, name, password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token', msg: 'Invite token required' });
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'password', msg: 'Choose a password of at least 8 characters' });
    }
    if (!inviteStore) return res.status(503).json({ error: 'unavailable' });

    const result = await inviteStore.consume(String(token));
    if (result.invalid) return res.status(404).json({ error: 'invalid', msg: 'This invite link is not valid' });
    if (result.used) return res.status(409).json({ error: 'used', msg: 'This invite link was already used' });
    if (result.expired) return res.status(410).json({ error: 'expired', msg: 'This invite link has expired — ask the admin for a new one' });

    const email = result.invite.email;
    const displayName = String(name || '').trim().slice(0, 60) || email.split('@')[0];

    // The admin pre-provisions the seller account. A passwordless placeholder
    // (created e.g. by a buyer conversation) may be upgraded — but an account
    // that already has a real password must NEVER be reset by an invite link:
    // a typo'd (or malicious) invite would otherwise be a no-consent password
    // reset / account takeover for any user, wallet balance included.
    let user = await store.getUser(email);
    if (user && user.passHash) {
      return res.status(409).json({
        error: 'exists',
        msg: 'This email already has an account — sign in instead, or ask the admin to invite a different email',
      });
    }
    if (!user) {
      const salt = crypto.randomBytes(16).toString('hex');
      user = {
        _id: email,
        name: displayName,
        passHash: hash(password, salt),
        salt,
        token: newToken(),
        tokenIssuedAt: new Date(),
        isSeller: true,
        createdAt: new Date(),
      };
    } else {
      const salt = crypto.randomBytes(16).toString('hex');
      user.passHash = hash(password, salt);
      user.salt = salt;
      user.isSeller = true;
      user.token = newToken();
      user.tokenIssuedAt = new Date();
      if (name) user.name = displayName;
    }
    await store.putUser(user);

    // Provision the seller profile as verified (invite-only = admin-verified).
    const profile = await sellerStore.ensureSellerProfile(email, displayName);
    profile.verified = true;
    profile.verifiedAt = profile.verifiedAt || new Date();
    await sellerStore.saveSellerProfile(profile);

    const seller = sellerStore.serializeSellerProfile(profile);
    res.json({ token: user.token, user: userPayload(user, seller) });
  } catch (err) {
    console.error('invite claim error:', err.message);
    res.status(500).json({ error: 'server' });
  }
});

validateEnv();
connectDb().then(async () => {
  sellerStore = createSellerStore({ memory, listingsCol, sellerProfilesCol, withdrawalsCol, escrowsCol, reviewsCol, mongoClient, txnSupported });
  paymentStore = createPaymentStore({ memory, paymentsCol });
  walletStore = createWalletStore({ memory, walletsCol });
  inviteStore = createInviteStore({ memory, invitesCol });
  stockStore = createStockStore({ memory, stockCol });
  verificationStore = createVerificationStore({ memory, verificationsCol });
  await ensureBootstrapAdmin();
  // Quota bookkeeping: unprefixed orphan chat images are spread across owners.
  try {
    const ownerCount = memory ? memory.users.size : await usersCol.estimatedDocumentCount();
    setChatOwnerCount(ownerCount);
  } catch (_) {}
  registerSellerRoutes(app, { authUser, store, sellerStore, sellerEmailFromName, paymentStore, walletStore, writeLimiter, readLimiter });
  registerStockRoutes(app, { authUser, sellerStore, paymentStore, stockStore, writeLimiter });
  // Auto-deliver a stocked credential the instant a payment confirms, and email
  // it to the buyer. Sale + confirmation emails fire on the same paid hook.
  const deliverForOrder = (orderId) => autoDeliver({
    paymentStore, sellerStore, stockStore, orderId,
    onDelivered: notify.notifyCredential,
  });
  const paymentApi = registerPaymentRoutes(app, {
    authUser, paymentStore, sellerStore, walletStore, paymentLimiter, stockStore,
    onPaymentPaid: async (doc) => {
      notify.notifyPaid(doc);
      await deliverForOrder(doc.orderId);
    },
  });
  registerWalletRoutes(app, {
    authUser, walletStore, sellerStore, paymentStore, creditDeposit: paymentApi.creditDeposit, paymentLimiter, stockStore,
  });
  registerAdminRoutes(app, {
    authUser, store, sellerStore, paymentStore, withdrawalsCol, memory, listingsCol, usersCol, walletStore,
    inviteStore, portalAccess, stockStore, sellerProfilesCol, paymentsCol,
  });
  ensureChatUploadDir();
  ensureListingUploadDir(path.join(__dirname, 'public'));
  // Sweep chat images no message references (all unprefixed orphans + files
  // whose conversation was deleted), so storage doesn't grow unbounded.
  try {
    const keep = new Set();
    if (memory) {
      for (const list of memory.messages.values()) {
        for (const m of list) if (m.image) keep.add(path.basename(m.image));
      }
    } else {
      const withImages = await messagesCol.find({ image: { $ne: null } }, { projection: { image: 1 } }).toArray();
      for (const m of withImages) if (m.image) keep.add(path.basename(m.image));
    }
    const removed = sweepChatImages(keep);
    if (removed) console.log('   Cleaned ' + removed + ' orphaned chat image(s).');
  } catch (_) {}
  app.listen(PORT, () => {
    console.log(`Dot Marketplace → http://localhost:${PORT}`);
    console.log('   Marketplace:  http://localhost:' + PORT + '/');
    if (portalAccess.disabled) {
      console.log('   ⚠ Portals served PUBLICLY at /seller/ and /admin/ (PORTAL_DISABLE=true)');
    } else {
      console.log('   Portals (secret path, IP-restricted: ' + (portalAccess.ipAllowed ? 'yes' : 'no') + '):');
      console.log('     Seller: http://localhost:' + PORT + portalAccess.mountBase + '/seller/');
      console.log('     Admin:  http://localhost:' + PORT + portalAccess.mountBase + '/admin/');
      if (!portalAccess.secretConfigured) {
        console.log('     ⚠ Using default dev secret path — set PORTAL_SECRET_PATH before going live.');
      }
    }
    console.log('   Admin: ' + (process.env.ADMIN_EMAIL || 'admin@dot.market'));
    console.log('   Payments: ' + payments.provider() + (payments.isConfigured() ? ' (configured)' : ' (not configured — wallet only)'));
  });
}).catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
