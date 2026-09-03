#!/usr/bin/env node
/**
 * Remove all demo listings and seller profiles from MongoDB.
 * This empties the Market page and the Community seller leaderboard.
 *
 * Usage: node scripts/clear-marketplace.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
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
