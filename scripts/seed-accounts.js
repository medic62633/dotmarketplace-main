#!/usr/bin/env node
/**
 * Create demo buyer & seller accounts in MongoDB.
 * Usage: npm run seed:accounts
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PASSWORD = 'test12345';

const BUYERS = [
  { name: 'Alex Buyer', email: 'alex.buyer@test.com' },
  { name: 'Jamie Shopper', email: 'jamie@test.com' },
  { name: 'Demo Trader', email: 'demo@test.com' },
];

const SELLERS = [
  { name: 'Anna Pixel', email: 'anna.pixel@sellers.dot.market' },
  { name: 'M. Okafor', email: 'm.okafor@sellers.dot.market' },
  { name: 'Devraj S.', email: 'devraj.s@sellers.dot.market' },
  { name: 'kazuto', email: 'kazuto@sellers.dot.market' },
  { name: 'Studio Nara', email: 'studio.nara@sellers.dot.market' },
  { name: 'Lena V.', email: 'lena.v@sellers.dot.market' },
  { name: 'bytehaus', email: 'bytehaus@sellers.dot.market' },
];

const hash = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

function makeUser({ name, email, isSeller }) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    _id: email.toLowerCase(),
    name,
    passHash: hash(PASSWORD, salt),
    salt,
    token: newToken(),
    isSeller: !!isSeller,
    createdAt: new Date(),
  };
}

function starterState() {
  return {
    deals: [],
    bal: 2500,
    txs: [
      { k: 'in', lbl: 'Seed deposit · USDT (TRC-20)', amt: 2500, t: 'just now' },
    ],
  };
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const users = client.db('dotmarket').collection('users');
    const states = client.db('dotmarket').collection('states');
    const wallets = client.db('dotmarket').collection('wallets');

    let created = 0;
    let updated = 0;

    for (const b of BUYERS) {
      const user = makeUser({ ...b, isSeller: false });
      const existing = await users.findOne({ _id: user._id });
      await users.replaceOne({ _id: user._id }, user, { upsert: true });
      if (!existing) {
        await states.replaceOne(
          { _id: user._id },
          { _id: user._id, state: starterState(), updatedAt: new Date() },
          { upsert: true }
        );
        // Wallet balance is server-authoritative — seed it directly.
        await wallets.replaceOne(
          { _id: user._id },
          {
            _id: user._id,
            balance: 2500,
            holds: [],
            ledger: [{ type: 'deposit', amt: 2500, lbl: 'Seed deposit · USDT (TRC-20)', at: new Date() }],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { upsert: true }
        );
        created++;
      } else updated++;
    }

    for (const s of SELLERS) {
      const user = makeUser({ ...s, isSeller: true });
      const existing = await users.findOne({ _id: user._id });
      await users.replaceOne({ _id: user._id }, user, { upsert: true });
      const profiles = client.db('dotmarket').collection('seller_profiles');
      const { defaultSellerProfile } = require('../lib/seller-store');
      const p = defaultSellerProfile(s.email, s.name);
      p.verified = true;
      p.verifiedAt = new Date();
      p.balance = 250;
      p.rate = 4.9;
      p.deals = 12;
      await profiles.replaceOne({ _id: p._id }, p, { upsert: true });
      existing ? updated++ : created++;
    }

    console.log('');
    console.log('Test accounts ready (password for all: ' + PASSWORD + ')');
    console.log('');
    console.log('Buyers (2,500 USDT wallet balance):');
    BUYERS.forEach(b => console.log('  • ' + b.email.padEnd(28) + '  ' + b.name));
    console.log('');
    console.log('Sellers (reply to buyer messages):');
    SELLERS.forEach(s => console.log('  • ' + s.email.padEnd(28) + '  ' + s.name));
    console.log('');
    console.log(`Done — ${created} created, ${updated} updated.`);
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
