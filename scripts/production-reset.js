#!/usr/bin/env node
/**
 * Production reset: keep ONLY the three real accounts and wipe everything else.
 *
 * Keeps (users only):
 *   • demo400@test.com      (buyer)
 *   • rockstar@gmail.com    (seller)
 *   • godforever@gmail.com  (admin)
 *
 * Removes:
 *   • every other user account
 *   • ALL listings, payments, escrows, conversations, messages, reviews,
 *     withdrawals, stock, invites, email_verifications
 *   • per-user state + wallets for any non-kept account
 *   • the kept seller's demo ledger is zeroed (fresh balance) and the kept
 *     buyer's demo wallet is zeroed so no demo money carries into production.
 *
 * This is DESTRUCTIVE and irreversible. Run only against the intended DB.
 *
 * Usage: node scripts/production-reset.js
 *        node scripts/production-reset.js --yes   (skip the confirmation prompt)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const { MongoClient } = require('mongodb');

const KEEP = ['demo400@test.com', 'rockstar@gmail.com', 'godforever@gmail.com'];
const KEEP_SELLER = 'rockstar@gmail.com';

// Collections that are wiped entirely (demo/activity data).
const WIPE_ALL = [
  'listings', 'payments', 'escrows', 'conversations', 'messages',
  'reviews', 'withdrawals', 'stock', 'invites', 'email_verifications',
];
// Collections keyed by user email — wipe rows NOT belonging to kept accounts.
const WIPE_OTHERS = ['states', 'wallets', 'seller_profiles'];

function confirm(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, ans => { rl.close(); resolve(/^y(es)?$/i.test(ans.trim())); });
  });
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set in .env'); process.exit(1); }

  if (!process.argv.includes('--yes')) {
    console.log('\nAbout to RESET the database to a clean production state.');
    console.log('Keeping only: ' + KEEP.join(', '));
    const ok = await confirm('Type "yes" to proceed: ');
    if (!ok) { console.log('Aborted.'); process.exit(0); }
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db('dotmarket');
    const now = new Date();
    const report = [];

    // 1) Remove non-kept users.
    const delUsers = await db.collection('users').deleteMany({ _id: { $nin: KEEP } });
    report.push(['users (non-kept) deleted', delUsers.deletedCount]);

    // 2) Wipe activity collections entirely.
    for (const col of WIPE_ALL) {
      const r = await db.collection(col).deleteMany({});
      report.push([col + ' wiped', r.deletedCount]);
    }

    // 3) Wipe per-user docs for non-kept accounts.
    for (const col of WIPE_OTHERS) {
      const r = await db.collection(col).deleteMany({ _id: { $nin: KEEP } });
      report.push([col + ' (non-kept) deleted', r.deletedCount]);
    }

    // 4) Reset the kept seller's profile to a clean zeroed state (no demo earnings).
    await db.collection('seller_profiles').updateOne(
      { _id: KEEP_SELLER },
      {
        $set: {
          balance: 0, pendingEscrow: 0, totalEarnings: 0, deals: 0,
          ledger: [], withdrawAddress: '', updatedAt: now,
        },
        $setOnInsert: { _id: KEEP_SELLER, name: 'rockstar', verified: true, createdAt: now },
      },
      { upsert: true }
    );
    report.push(['seller profile zeroed', KEEP_SELLER]);

    // 5) Zero the kept buyer's demo wallet so no demo balance carries over.
    await db.collection('wallets').updateOne(
      { _id: 'demo400@test.com' },
      { $set: { balance: 0, holds: [], ledger: [], updatedAt: now } }
    );
    report.push(['buyer wallet zeroed', 'demo400@test.com']);

    // 6) Clear the kept buyer's client state (deals/txs) for a clean first render.
    await db.collection('states').updateOne(
      { _id: 'demo400@test.com' },
      { $set: { state: { deals: [], bal: 0, txs: [] }, updatedAt: now } }
    );

    const remaining = await db.collection('users').find({}, { projection: { name: 1, isSeller: 1, isAdmin: 1 } }).toArray();

    console.log('\n✔ Production reset complete.\n');
    report.forEach(([k, v]) => console.log('  ' + k + ': ' + v));
    console.log('\nAccounts remaining (' + remaining.length + '):');
    remaining.forEach(u => {
      const role = u.isAdmin ? 'admin' : u.isSeller ? 'seller' : 'buyer';
      console.log('  • ' + u._id + '  (' + (u.name || '') + ', ' + role + ')');
    });
    console.log('');
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Reset failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
