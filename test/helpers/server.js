/* Spawns the real server.js as a child process against the in-memory store,
 * for black-box integration tests over HTTP — the same surface a browser or
 * a client actually hits, so these tests catch the class of bug this repo
 * keeps producing (a working backend endpoint the frontend never calls
 * correctly, or vice versa) rather than just unit-testing internals. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
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
 * Ports come from the OS (see freePort), but two servers can still be handed
 * the same one: the probe socket is closed before the child binds, so a
 * concurrent probe can be given the same number in that window. A server that
 * loses the race exits, and a plain health check on that port then succeeds —
 * answered by the OTHER test's server. The test carries on against a process
 * with someone else's config and store, which surfaces later as an
 * inexplicable assertion failure (a pool reported as empty immediately after
 * it reported two addresses, say).
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
      // fetch() refuses to connect to an "unsafe" port (6000 X11, 6667 IRC,
      // 5060 SIP, and nine others) no matter what is listening on it. Treating
      // that as "not up yet" burned the whole timeout and then blamed the
      // server, which was in fact running perfectly — so say what happened.
      if (/bad port/i.test(err?.cause?.message || err.message || '')) {
        throw new BadPortError('port ' + new URL(baseUrl).port + ' is one fetch() refuses to connect to');
      }
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy within ' + timeoutMs + 'ms');
}

class PortTakenError extends Error {}
class BadPortError extends Error {}

/* Ports fetch() will not connect to, whatever is listening (undici's
 * "bad port" list). Nothing in the OS ephemeral range hits these, so this is a
 * guard against a future change reintroducing a hand-picked range — not a
 * filter the current draw needs. */
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101,
  102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389,
  427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
  6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/* Ask the OS for a free port instead of drawing from a fixed range.
 *
 * The old draw was 4100 + random(4000), which had two problems. Collisions:
 * 45 servers over 4000 ports is a ~22% chance per run that two tests pick the
 * same number. And twelve of those 4000 ports are ones fetch() flatly refuses
 * to connect to — a 0.3% shot per server, so ~13% of full-suite runs drew one
 * and failed a test whose server was fine.
 *
 * Binding port 0 hands back an OS-assigned ephemeral port (32768-60999 here),
 * which is both far less contended and free of unsafe ports. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => (UNSAFE_PORTS.has(port) ? freePort().then(resolve, reject) : resolve(port)));
    });
  });
}

/** Start an isolated server instance on a free-ish port. Pass extra env to
 * tweak behavior per suite (e.g. SESSION_TTL_DAYS for expiry tests). */
async function startServer(extraEnv = {}, attempt = 0) {
  const port = await freePort();
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
    if ((err instanceof PortTakenError || err instanceof BadPortError) && attempt < 5) {
      return startServer(extraEnv, attempt + 1);
    }
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
