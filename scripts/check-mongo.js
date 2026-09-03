#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set in .env');
  process.exit(1);
}

function fetchPublicIp() {
  return new Promise((resolve) => {
    https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(null));
  });
}

function isAtlasTlsBlock(err) {
  const msg = String(err?.message || err);
  return msg.includes('tlsv1 alert internal error') || msg.includes('SSL alert number 80');
}

(async () => {
  const redacted = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log('Testing', redacted);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    await client.db('dotmarket').command({ ping: 1 });
    console.log('OK — MongoDB is reachable.');
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL —', err.message.split('\n')[0]);
    if (uri.startsWith('mongodb+srv://') && isAtlasTlsBlock(err)) {
      const ip = await fetchPublicIp();
      console.error('');
      console.error('Atlas is rejecting the TLS handshake from this machine.');
      console.error('This usually means your IP is not on the Atlas Network Access allowlist.');
      if (ip) console.error('Add this IP in Atlas → Network Access → Add IP Address:', ip);
      console.error('');
      console.error('For local development, run:');
      console.error('  docker compose up -d');
      console.error('  # then set MONGODB_URI=mongodb://127.0.0.1:27017/dotmarket in .env');
    }
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
