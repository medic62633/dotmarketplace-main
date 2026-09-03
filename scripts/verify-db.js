#!/usr/bin/env node
/* Exercises the transaction and schema-validation machinery added for money
 * paths (see lib/seller-store.js's runTxn, lib/schemas.js) against a REAL
 * MongoDB — something that was only ever verified against the in-memory dev
 * store during development (no Docker/network access in that environment).
 *
 * Safe to run against production: every check below operates on a single
 * dedicated scratch collection (`_db_verify_scratch`), created fresh and
 * dropped at the end (even on failure). It never reads, writes, or drops any
 * of the app's real collections (users, wallets, escrows, payments, ...) —
 * the "indexes" check only lists what already exists, read-only.
 *
 * Usage:
 *   npm run db:verify
 *   node scripts/verify-db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const { schemas } = require('../lib/schemas');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set in .env — nothing to verify.');
  process.exit(1);
}

const SCRATCH = '_db_verify_scratch';
let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log('  ✓ ' + label);
}
function bad(label, err) {
  failed++;
  console.log('  ✗ ' + label + (err ? ' — ' + (err.message || err) : ''));
}

(async () => {
  const redacted = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log('Verifying', redacted);
  console.log();

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  let db;
  try {
    await client.connect();
    db = client.db('dotmarket');
  } catch (err) {
    console.error('FAIL — could not connect:', err.message.split('\n')[0]);
    process.exit(1);
  }

  console.log('1. Connectivity');
  try {
    await db.command({ ping: 1 });
    ok('ping');
  } catch (err) {
    bad('ping', err);
  }

  console.log('2. Replica set / transaction support');
  let txnSupported = false;
  try {
    const hello = await db.admin().command({ hello: 1 });
    txnSupported = !!hello.setName;
    if (txnSupported) ok(`replica set "${hello.setName}" — transactions supported`);
    else console.log('  ⚠ standalone (no setName) — money paths will use their non-transactional fallback, same as before transactions existed. See scripts/db-up.sh for a local replica-set Mongo, or Atlas is always one.');
  } catch (err) {
    bad('hello', err);
  }

  // Everything below uses ONLY this scratch collection. Explicitly (re)create
  // it so collMod in step 5 has something to modify even when steps 3/4 were
  // skipped (no replica set) and never implicitly created it via insertOne.
  await db.collection(SCRATCH).drop().catch(() => {});
  await db.createCollection(SCRATCH);
  const scratch = db.collection(SCRATCH);

  console.log('3. Multi-document transaction (commit)');
  if (txnSupported) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await scratch.insertOne({ _id: 'txn-a', v: 1 }, { session });
        await scratch.updateOne({ _id: 'txn-a' }, { $set: { v: 2 } }, { session });
      });
      const doc = await scratch.findOne({ _id: 'txn-a' });
      if (doc && doc.v === 2) ok('transaction committed both writes');
      else bad('transaction commit', new Error('doc missing or not updated: ' + JSON.stringify(doc)));
    } catch (err) {
      bad('transaction commit', err);
    } finally {
      await session.endSession();
    }
  } else {
    console.log('  – skipped (no replica set)');
  }

  console.log('4. Multi-document transaction (abort leaves no partial write)');
  if (txnSupported) {
    const session = client.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          await scratch.insertOne({ _id: 'txn-b', v: 1 }, { session });
          throw new Error('deliberate abort');
        });
      } catch (err) {
        if (err.message !== 'deliberate abort') throw err;
      }
      const doc = await scratch.findOne({ _id: 'txn-b' });
      if (!doc) ok('aborted transaction left no partial write (this is exactly what protects a mid-crash escrow payout/refund)');
      else bad('transaction abort', new Error('partial write survived: ' + JSON.stringify(doc)));
    } catch (err) {
      bad('transaction abort', err);
    } finally {
      await session.endSession();
    }
  } else {
    console.log('  – skipped (no replica set)');
  }

  console.log('5. JSON Schema validation (escrows schema, on the scratch collection)');
  try {
    await db.command({
      collMod: SCRATCH,
      validator: { $jsonSchema: schemas.escrows },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    try {
      await scratch.insertOne({ _id: 'schema-valid', sellerEmail: 'seller@example.com', amount: 10, status: 'held' });
      ok('accepted a valid escrow-shaped document');
    } catch (err) {
      bad('valid document was rejected', err);
    }
    try {
      await scratch.insertOne({ _id: 'schema-invalid', sellerEmail: 'seller@example.com', amount: 10, status: 'not_a_real_status' });
      bad('invalid document was accepted (status enum not enforced)');
    } catch (err) {
      ok('rejected an invalid document (bad status enum) — see: ' + err.message.split('\n')[0]);
    }
  } catch (err) {
    bad('applying the validator', err);
  }

  console.log('6. Existing indexes on the app\'s real collections (read-only)');
  const appCollections = ['users', 'payments', 'invites', 'stock', 'escrows', 'wallets', 'seller_profiles', 'withdrawals'];
  for (const name of appCollections) {
    try {
      const idx = await db.collection(name).indexes();
      console.log(`  ${name}: ${idx.map(i => i.name).join(', ')}`);
    } catch (err) {
      console.log(`  ${name}: (could not list — ${err.message.split('\n')[0]})`);
    }
  }

  await scratch.drop().catch(() => {});
  await client.close();

  console.log();
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})();
