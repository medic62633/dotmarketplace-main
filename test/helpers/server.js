/* Spawns the real server.js as a child process against the in-memory store,
 * for black-box integration tests over HTTP — the same surface a browser or
 * a client actually hits, so these tests catch the class of bug this repo
 * keeps producing (a working backend endpoint the frontend never calls
 * correctly, or vice versa) rather than just unit-testing internals. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

/* Waits for OUR server, not merely for something on that port.
 *
 * node --test runs test files concurrently, each spawning its own real
 * server.js child — on a loaded/throttled CI runner, enough of them booting
 * at once can push a cold Node start (dotenv, scrypt-hashing the bootstrap
 * admin password, in-memory store setup) past a tight timeout even though
 * nothing is broken. 15s gives real headroom without masking a genuinely
 * hung server.
 *
 * Ports are picked at random from a small range and the whole suite starts
 * dozens of servers, so collisions happen (36 draws from 4000 is ~15% odds of
 * at least one). A server that loses the race exits, and a plain health check
 * on that port then succeeds — answered by the OTHER test's server. The test
 * carries on against a process with someone else's config and store, which
 * surfaces later as an inexplicable assertion failure (a pool reported as
 * empty immediately after it reported two addresses, say).
 *
 * So the health check has to prove identity: INSTANCE_ID is echoed by
 * /healthz, and anything else answering means we lost the port and should try
 * a different one. Also gives up early if the child has already exited. */
async function waitForHealth(baseUrl, instanceId, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new PortTakenError('server process exited before becoming healthy');
    try {
      const r = await fetch(baseUrl + '/healthz');
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.instance === instanceId) return;
        throw new PortTakenError('another server is listening on this port');
      }
    } catch (err) {
      if (err instanceof PortTakenError) throw err;
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy within ' + timeoutMs + 'ms');
}

class PortTakenError extends Error {}

/** Start an isolated server instance on a free-ish port. Pass extra env to
 * tweak behavior per suite (e.g. SESSION_TTL_DAYS for expiry tests). */
async function startServer(extraEnv = {}, attempt = 0) {
  const port = 4100 + Math.floor(Math.random() * 4000);
  const instanceId = crypto.randomUUID();
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
      INSTANCE_ID: instanceId,
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
    await waitForHealth(baseUrl, instanceId, child);
  } catch (err) {
    child.kill();
    fs.rmSync(cwd, { recursive: true, force: true });
    // Lost the port to another test's server — take a different one. Bounded,
    // so a genuinely broken server still fails loudly instead of looping.
    if (err instanceof PortTakenError && attempt < 5) return startServer(extraEnv, attempt + 1);
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
