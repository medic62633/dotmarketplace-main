#!/usr/bin/env node
/**
 * Re-key conversations so they reference the real seller account email.
 *
 * Problem: older DMs/threads were keyed on a name-derived placeholder like
 * rockstar@sellers.dot.market, so the real seller login (rockstar@gmail.com)
 * never saw them. This rewrites sellerEmail (and the participants list) on any
 * conversation whose sellerEmail is a *@sellers.dot.market placeholder that
 * maps to a real user account email.
 *
 * Usage: node scripts/fix-conversation-emails.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set in .env'); process.exit(1); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db('dotmarket');
    const convs = db.collection('conversations');
    const users = db.collection('users');

    const all = await convs.find({}).toArray();
    let fixed = 0;
    for (const conv of all) {
      const old = String(conv.sellerEmail || '');
      if (!old.endsWith('@sellers.dot.market')) continue;
      const nameSlug = old.replace(/@sellers\.dot\.market$/, '');
      // Find a real seller user whose name slugifies to this placeholder, or an
      // exact listing sellerEmail match.
      const listing = await db.collection('listings').findOne({ sellerEmail: { $exists: true } });
      // Prefer: a real user account that is a seller and whose name slug matches.
      const candidates = await users.find({ isSeller: true }).toArray();
      const slugify = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
      let real = candidates.find(u => slugify(u.name) === nameSlug);
      // Or a real account whose email local-part matches (rockstar@gmail.com ~ rockstar@...)
      if (!real) real = candidates.find(u => String(u._id).split('@')[0] === nameSlug);
      if (!real) continue;

      const newEmail = real._id;
      const participants = (conv.participants || []).map(p => (p === old ? newEmail : p));
      await convs.updateOne(
        { _id: conv._id },
        { $set: { sellerEmail: newEmail, participants } }
      );
      console.log(`fixed ${conv._id}: ${old} -> ${newEmail}`);
      fixed++;
    }
    console.log(fixed ? `\nDone — ${fixed} conversation(s) re-keyed.` : '\nNo placeholder conversations needed fixing.');
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
