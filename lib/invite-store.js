/* Admin-provisioned seller invites (invite-only seller onboarding).
 *
 * There is no public "become a seller" signup. An admin generates a one-time
 * invite for a seller email; the raw invite token is shown to the admin ONCE
 * (inside the setup link) and only ever stored as a SHA-256 hash, so a database
 * leak never exposes usable invite links. Claiming the link creates the seller
 * account with an admin-set temporary password and marks the seller verified.
 *
 * Backwards/forwards compatible: invites persist in Mongo when configured and
 * fall back to the in-memory map in local/dev.
 */
const crypto = require('crypto');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createInviteStore({ memory, invitesCol }) {
  async function getByHash(tokenHash) {
    if (memory) {
      for (const inv of memory.invites.values()) {
        if (inv.tokenHash === tokenHash) return inv;
      }
      return null;
    }
    return invitesCol.findOne({ tokenHash });
  }

  async function save(doc) {
    doc.updatedAt = new Date();
    if (memory) {
      memory.invites.set(doc._id, doc);
      return;
    }
    await invitesCol.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }

  async function listRecent(limit = 100) {
    if (memory) {
      return [...memory.invites.values()]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }
    return invitesCol.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  /**
   * Create a fresh invite for an email. Any prior unused invites for the same
   * email are superseded (marked) so only the newest link is valid. Returns
   * { invite, rawToken } — rawToken is the ONLY time the secret is available.
   */
  async function createInvite(email, createdBy) {
    const id = crypto.randomBytes(12).toString('hex');
    const rawToken = crypto.randomBytes(24).toString('hex');
    const doc = {
      _id: id,
      email: String(email).toLowerCase(),
      tokenHash: hashToken(rawToken),
      status: 'unused', // unused | used | superseded
      createdBy: createdBy || null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      usedAt: null,
    };

    // Supersede earlier unused invites for this email so only one link is live.
    const prior = memory
      ? [...memory.invites.values()].filter(i => i.email === doc.email && i.status === 'unused')
      : await invitesCol.find({ email: doc.email, status: 'unused' }).toArray();
    for (const p of prior) {
      p.status = 'superseded';
      await save(p);
    }

    await save(doc);
    return { invite: doc, rawToken };
  }

  /**
   * Atomically consume an invite by its raw token. Succeeds exactly once —
   * concurrent/double claims lose the race (status must still be 'unused').
   * Returns { invite } on success, { invalid:true } if the token is unknown,
   * { used:true } if already claimed, { expired:true } if past its TTL.
   */
  async function consume(rawToken) {
    if (!rawToken) return { invalid: true };
    const tokenHash = hashToken(rawToken);

    if (memory) {
      const inv = await getByHash(tokenHash);
      if (!inv) return { invalid: true };
      if (inv.status !== 'unused') return { used: true };
      if (new Date(inv.expiresAt).getTime() < Date.now()) return { expired: true };
      inv.status = 'used';
      inv.usedAt = new Date();
      memory.invites.set(inv._id, inv);
      return { invite: inv };
    }

    // Exclude expired invites from the claim itself — an expired token must
    // never be flipped to 'used' (that would misreport it in the admin list
    // as genuinely claimed, and mirrors the in-memory path checking expiry
    // before mutating status).
    const res = await invitesCol.findOneAndUpdate(
      { tokenHash, status: 'unused', expiresAt: { $gt: new Date() } },
      { $set: { status: 'used', usedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) {
      const cur = await getByHash(tokenHash);
      if (!cur) return { invalid: true };
      if (new Date(cur.expiresAt).getTime() < Date.now()) return { expired: true };
      return { used: true };
    }
    return { invite: doc };
  }

  return { createInvite, consume, listRecent, getByHash, hashToken };
}

module.exports = { createInviteStore, hashToken, INVITE_TTL_MS };
