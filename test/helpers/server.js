/* Spawns the real server.js as a child process against the in-memory store,
 * for black-box integration tests over HTTP — the same surface a browser or
 * a client actually hits, so these tests catch the class of bug this repo
 * keeps producing (a working backend endpoint the frontend never calls
 * correctly, or vice versa) rather than just unit-testing internals. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// node --test runs multiple test files concurrently by default, each
// spawning its own real server.js child process — on a loaded/throttled CI
// runner, enough of them booting at once can push a cold Node start (dotenv,
// scrypt-hashing the bootstrap admin password, in-memory store setup) past a
// tight timeout even though nothing is actually broken. 15s gives real
// headroom without masking a genuinely hung/crashed server.
async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(baseUrl + '/healthz');
      if (r.ok) return;
    } catch (_) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy within ' + timeoutMs + 'ms');
}

/** Start an isolated server instance on a free-ish port. Pass extra env to
 * tweak behavior per suite (e.g. SESSION_TTL_DAYS for expiry tests). */
async function startServer(extraEnv = {}) {
  const port = 4100 + Math.floor(Math.random() * 4000);
  // Run from an empty temp cwd so server.js's dotenv.config() finds no .env —
  // a developer's local (or production!) .env must never leak into a test run:
  // NODE_ENV=production forbids DEMO_AUTH, ADMIN_PASSWORD breaks fixtures, and
  // SMTP/payment keys would let a test send real email or hit real accounts.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dotm-test-'));
  const child = spawn('node', [path.join(__dirname, '..', '..', 'server.js')], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ALLOW_MEMORY_STORE: 'true',
      DEMO_AUTH: 'true',
      PORT: String(port),
      MONGODB_URI: '',
      SMTP_HOST: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });

  const baseUrl = 'http://127.0.0.1:' + port;
  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    child.kill();
    throw new Error(err.message + '\n--- server output ---\n' + out);
  }

  async function api(method, urlPath, { token, body } = {}) {
    const r = await fetch(baseUrl + urlPath, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
  }

  function stop() {
    child.kill();
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  return { baseUrl, api, stop };
}

module.exports = { startServer };
