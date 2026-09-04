#!/usr/bin/env node
/**
 * Provision the real seller + admin accounts and remove every other account
 * (and its data) except the ones we explicitly keep.
 *
 * Keeps:  demo400@test.com (buyer), the new seller, the new admin.
 * Removes: all other users, plus their states, wallets, and seller_profiles.
 *
 * Usage: node scripts/setup-real-accounts.js <password>
 *        SETUP_ACCOUNTS_PASSWORD=... node scripts/setup-real-accounts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PASSWORD = process.argv[2] || process.env.SETUP_ACCOUNTS_PASSWORD;
if (!PASSWORD) {
  console.error('Usage: node scripts/setup-real-accounts.js <password>');
  console.error('  (or set SETUP_ACCOUNTS_PASSWORD in the environment)');
  process.exit(1);
}

const SELLER = { email: 'rockstar@gmail.com', name: 'rockstar' };
const ADMIN = { email: 'godforever@gmail.com', name: 'Admin' };
const KEEP_BUYER = 'demo400@test.com';

const hash = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

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
    const users = db.collection('users');
    const states = db.collection('states');
    const wallets = db.collection('wallets');
    const profiles = db.collection('seller_profiles');
    const listings = db.collection('listings');

    const now = new Date();
    const mk = (email, extra) => {
      const salt = crypto.randomBytes(16).toString('hex');
      return {
        _id: email.toLowerCase(),
        passHash: hash(PASSWORD, salt),
        salt,
        token: newToken(),
        createdAt: now,
        ...extra,
      };
    };

    // 1) Real seller — verified so it can operate immediately, otherwise empty.
    await users.replaceOne(
      { _id: SELLER.email },
      mk(SELLER.email, { name: SELLER.name, isSeller: true }),
      { upsert: true }
    );
    await profiles.replaceOne(
      { _id: SELLER.email },
      {
        _id: SELLER.email,
        name: SELLER.name,
        verified: true,
        verifiedAt: now,
        balance: 0,
        pendingEscrow: 0,
        totalEarnings: 0,
        deals: 0,
        rate: 5,
        since: now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        withdrawAddress: '',
        ledger: [],
        createdAt: now,
        updatedAt: now,
      },
      { upsert: true }
    );

    // 2) Real admin — no wallet, no seller profile.
    await users.replaceOne(
      { _id: ADMIN.email },
      mk(ADMIN.email, { name: ADMIN.name, isAdmin: true }),
      { upsert: true }
    );

    // 3) Delete every other user and its related data.
    const keep = [SELLER.email, ADMIN.email, KEEP_BUYER];
    const del = await users.deleteMany({ _id: { $nin: keep } });
    const delStates = await states.deleteMany({ _id: { $nin: keep } });
    const delWallets = await wallets.deleteMany({ _id: { $nin: keep } });
    const delProfiles = await profiles.deleteMany({ _id: { $nin: [SELLER.email] } });
    const delListings = await listings.deleteMany({});

    // Report what remains.
    const remaining = await users.find({}, { projection: { isSeller: 1, isAdmin: 1, name: 1 } }).toArray();

    console.log('');
    console.log('Real accounts created (password for both: ' + PASSWORD + ')');
    console.log('  Seller: ' + SELLER.email + '  (verified, empty)');
    console.log('  Admin:  ' + ADMIN.email);
    console.log('');
    console.log('Removed other accounts and data:');
    console.log('  Users deleted:           ' + del.deletedCount);
    console.log('  States deleted:          ' + delStates.deletedCount);
    console.log('  Wallets deleted:         ' + delWallets.deletedCount);
    console.log('  Seller profiles deleted: ' + delProfiles.deletedCount);
    console.log('  Listings deleted:        ' + delListings.deletedCount);
    console.log('');
    console.log('Accounts remaining:');
    remaining.forEach(u => {
      const role = u.isAdmin ? 'admin' : u.isSeller ? 'seller' : 'buyer';
      console.log('  • ' + u._id + '  (' + u.name + ', ' + role + ')');
    });
    console.log('');
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Setup failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
