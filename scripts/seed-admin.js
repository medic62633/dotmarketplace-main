#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PASSWORD = 'test12345';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@dot.market').toLowerCase();

const hash = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const users = client.db('dotmarket').collection('users');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      _id: ADMIN_EMAIL,
      name: 'Admin',
      passHash: hash(PASSWORD, salt),
      salt,
      token: newToken(),
      isAdmin: true,
      createdAt: new Date(),
    };
    await users.replaceOne({ _id: ADMIN_EMAIL }, user, { upsert: true });
    console.log('Admin account ready:');
    console.log('  Email:    ' + ADMIN_EMAIL);
    console.log('  Password: ' + PASSWORD);
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed admin failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
