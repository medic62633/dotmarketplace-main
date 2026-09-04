/* Email-verification codes for signup.
 *
 * A 6-digit code is generated per email, only its SHA-256 hash is stored (so a
 * DB leak doesn't expose live codes), with a short TTL and a resend cooldown.
 * Verification is single-winner: an already-verified or superseded code is
 * rejected, so a guessed/raced code can't verify twice.
 */
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;   // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 resend per minute
const MAX_ATTEMPTS = 8;               // lock after this many wrong tries

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function generateCode() {
  // 000000–999999, zero-padded, from a CSPRNG.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function createVerificationStore({ memory, verificationsCol }) {
  async function get(email) {
    if (memory) return memory.verifications.get(email) || null;
    return verificationsCol.findOne({ _id: email });
  }

  async function save(doc) {
    if (memory) { memory.verifications.set(doc._id, doc); return; }
    await verificationsCol.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }

  /* Record one wrong guess and return the new total. Atomic $inc on Mongo;
   * the memory store is single-threaded per tick between the read and the
   * write here, so a plain increment is equivalent there. */
  async function bumpAttempts(email) {
    if (memory) {
      const rec = memory.verifications.get(email);
      if (!rec) return MAX_ATTEMPTS;
      rec.attempts = (rec.attempts || 0) + 1;
      memory.verifications.set(email, rec);
      return rec.attempts;
    }
    const res = await verificationsCol.findOneAndUpdate(
      { _id: email },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    return doc?.attempts ?? MAX_ATTEMPTS;
  }

  /* Issue a fresh code. Enforces a resend cooldown unless forced. Returns
   * { code, record } to send, or { cooldown: retryAfterSec }. */
  async function issue(email, { force = false } = {}) {
    const now = Date.now();
    const existing = await get(email);
    if (!force && existing?.lastSentAt && now - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((RESEND_COOLDOWN_MS - (now - new Date(existing.lastSentAt).getTime())) / 1000);
      return { cooldown: retryAfterSec };
    }
    const code = generateCode();
    const record = {
      _id: email,
      codeHash: sha256(code),
      expiresAt: new Date(now + CODE_TTL_MS),
      attempts: 0,
      verifiedAt: null,
      lastSentAt: new Date(now),
    };
    await save(record);
    return { code, record };
  }

  /* Verify a submitted code. Single-winner, expiry + attempt-limited.
   * Returns { verified } | { invalid } | { expired } | { locked } | { mismatch }. */
  async function verify(email, code) {
    const rec = await get(email);
    if (!rec) return { invalid: true };
    if (rec.verifiedAt) return { verified: true, already: true };
    if (new Date(rec.expiresAt).getTime() < Date.now()) return { expired: true };
    if ((rec.attempts || 0) >= MAX_ATTEMPTS) return { locked: true };

    if (!/^\d{6}$/.test(String(code || '')) || sha256(code) !== rec.codeHash) {
      // Count the failure atomically. Read-modify-write here meant several
      // guesses fired at once each read the same `attempts` and wrote back
      // the same +1, so the lock-out could be walked past by sending guesses
      // in parallel instead of in sequence. The per-IP auth limiter is the
      // primary control, but a lock-out that concurrency defeats is not a
      // second layer at all.
      const attempts = await bumpAttempts(email);
      return { mismatch: true, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) };
    }

    rec.verifiedAt = new Date();
    await save(rec);
    return { verified: true };
  }

  async function isVerified(email) {
    const rec = await get(email);
    return !!rec?.verifiedAt;
  }

  async function clear(email) {
    if (memory) { memory.verifications.delete(email); return; }
    await verificationsCol.deleteOne({ _id: email });
  }

  return { issue, verify, isVerified, clear, CODE_TTL_MS, RESEND_COOLDOWN_MS, MAX_ATTEMPTS };
}

module.exports = { createVerificationStore };
