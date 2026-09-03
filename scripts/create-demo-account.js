#!/usr/bin/env node
/**
 * Create (or reset) a single demo buyer account with a chosen wallet balance.
 *
 * Usage:
 *   node scripts/create-demo-account.js [email] [balance] [name]
 *
 * Examples:
 *   node scripts/create-demo-account.js                       # demo400@test.com, 400 USDT
 *   node scripts/create-demo-account.js buyer@test.com 400
 *   node scripts/create-demo-account.js vip@test.com 1000 "VIP Buyer"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PASSWORD = 'test12345';

const email = (process.argv[2] || 'demo400@test.com').toLowerCase();
const balance = Math.max(0, Number(process.argv[3] || 400));
const name = process.argv[4] || 'Demo 400';

const hash = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Invalid email: ' + email);
    process.exit(1);
  }
  if (!Number.isFinite(balance)) {
    console.error('Invalid balance: ' + process.argv[3]);
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db('dotmarket');
    const users = db.collection('users');
    const states = db.collection('states');
    const wallets = db.collection('wallets');

    const salt = crypto.randomBytes(16).toString('hex');
    const now = new Date();

    await users.replaceOne(
      { _id: email },
      {
        _id: email,
        name,
        passHash: hash(PASSWORD, salt),
        salt,
        token: newToken(),
        isSeller: false,
        createdAt: now,
      },
      { upsert: true }
    );

    const ledgerEntry = { type: 'deposit', amt: balance, lbl: 'Demo starting balance · USDT', at: now };

    // Wallet is the server-authoritative balance.
    await wallets.replaceOne(
      { _id: email },
      {
        _id: email,
        balance,
        holds: [],
        ledger: balance > 0 ? [ledgerEntry] : [],
        createdAt: now,
        updatedAt: now,
      },
      { upsert: true }
    );

    // Keep the client-facing state doc in sync for a clean first render.
    await states.replaceOne(
      { _id: email },
      {
        _id: email,
        state: {
          deals: [],
          bal: balance,
          txs: balance > 0 ? [{ k: 'in', lbl: 'Demo starting balance · USDT', amt: balance, t: 'just now' }] : [],
        },
        updatedAt: now,
      },
      { upsert: true }
    );

    console.log('');
    console.log('Demo account ready:');
    console.log('  Email:    ' + email);
    console.log('  Password: ' + PASSWORD);
    console.log('  Name:     ' + name);
    console.log('  Balance:  ' + balance + ' USDT');
    console.log('');
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
