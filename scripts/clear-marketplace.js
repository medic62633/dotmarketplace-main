#!/usr/bin/env node
/**
 * Remove all demo listings and seller profiles from MongoDB.
 * This empties the Market page and the Community seller leaderboard.
 *
 * This is DESTRUCTIVE and irreversible. Run only against the intended DB.
 *
 * Usage: node scripts/clear-marketplace.js
 *        node scripts/clear-marketplace.js --yes   (skip the confirmation prompt)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const { MongoClient } = require('mongodb');

function confirm(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, ans => { rl.close(); resolve(/^y(es)?$/i.test(ans.trim())); });
  });
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.log('\nAbout to permanently delete ALL listings and seller profiles.');
    const ok = await confirm('Type "yes" to proceed: ');
    if (!ok) { console.log('Aborted.'); process.exit(0); }
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db('dotmarket');
    const listings = await db.collection('listings').deleteMany({});
    const profiles = await db.collection('seller_profiles').deleteMany({});
    console.log('Cleared marketplace:');
    console.log('  Listings deleted:        ' + listings.deletedCount);
    console.log('  Seller profiles deleted: ' + profiles.deletedCount);
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
