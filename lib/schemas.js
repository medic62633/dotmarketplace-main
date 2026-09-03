/* MongoDB JSON Schema validators, one per collection.
 *
 * These are a DB-layer safety net, not a replacement for the app-level checks
 * in lib/validate.js and each store module — they catch the case an app bug
 * (or a future change) tries to write a document that's missing an id, has
 * money fields of the wrong type, or a state-machine field outside its known
 * values.
 *
 * Deliberately loose:
 *  - `required` only lists fields every code path already sets when a
 *    document is first created (verified by reading every insertOne/
 *    replaceOne(...,{upsert:true}) call site). Nothing added later
 *    (e.g. `emailVerified`, `sales`) is required.
 *  - No `additionalProperties: false` anywhere — this app has been adding
 *    optional fields to these documents over time (variants, refundStatus,
 *    compromisedReason, ...) and a closed schema would turn the next such
 *    field into a production outage.
 *  - `enum` is only used where every writer of that field lives in one
 *    module we've read end-to-end (escrows.status: the whole state machine
 *    is lib/seller-store.js). Fields written from multiple route files
 *    (listings.status, payments.status, withdrawals.status) are left as
 *    plain strings instead of guessed enums.
 *  - Money fields use `bsonType: 'number'` with no `minimum` unless the
 *    store already guarantees non-negativity with a conditional filter
 *    before every decrement (wallet/seller balance). Fields like
 *    pendingEscrow are intentionally allowed to go negative for an instant
 *    between an $inc and its follow-up clamp — see seller-store.js.
 *
 * Applied with validationLevel 'moderate': only inserts and updates to
 * documents that already satisfy the schema are checked, so pre-existing
 * data (including anything already in the leaked/rotated .env-era database)
 * is never retroactively rejected.
 */

const schemas = {
  users: {
    bsonType: 'object',
    required: ['_id'],
    properties: {
      _id: { bsonType: 'string', description: 'email' },
      name: { bsonType: 'string' },
      passHash: { bsonType: 'string' },
      salt: { bsonType: 'string' },
      token: { bsonType: 'string' },
      isSeller: { bsonType: 'bool' },
      emailVerified: { bsonType: 'bool' },
    },
  },

  listings: {
    bsonType: 'object',
    required: ['_id', 'sellerEmail', 'status'],
    properties: {
      _id: { bsonType: 'string' },
      sellerEmail: { bsonType: 'string' },
      status: { bsonType: 'string' },
      price: { bsonType: ['number', 'null'] },
      variants: { bsonType: 'array' },
    },
  },

  seller_profiles: {
    bsonType: 'object',
    required: ['_id', 'balance'],
    properties: {
      _id: { bsonType: 'string' },
      // Guarded by a $gte conditional filter on every debit — never negative.
      balance: { bsonType: 'number', minimum: 0 },
      // NOT bounded: creditSellerPayout/resolveEscrow $inc this and clamp it
      // back to >=0 with a separate follow-up update, so it can be
      // momentarily negative between the two writes.
      pendingEscrow: { bsonType: 'number' },
      totalEarnings: { bsonType: 'number' },
      deals: { bsonType: 'number' },
      ledger: { bsonType: 'array' },
    },
  },

  withdrawals: {
    bsonType: 'object',
    required: ['_id', 'sellerEmail', 'amount', 'status'],
    properties: {
      _id: { bsonType: 'string' },
      sellerEmail: { bsonType: 'string' },
      amount: { bsonType: 'number', minimum: 0 },
      status: { bsonType: 'string' },
    },
  },

  payments: {
    bsonType: 'object',
    required: ['_id', 'orderId'],
    properties: {
      _id: { bsonType: 'string' },
      orderId: { bsonType: 'string' },
      status: { bsonType: 'string' },
      buyerEmail: { bsonType: ['string', 'null'] },
      sellerEmail: { bsonType: ['string', 'null'] },
    },
  },

  escrows: {
    bsonType: 'object',
    required: ['_id', 'sellerEmail', 'amount', 'status'],
    properties: {
      _id: { bsonType: 'string' },
      sellerEmail: { bsonType: 'string' },
      buyerEmail: { bsonType: ['string', 'null'] },
      amount: { bsonType: 'number', minimum: 0 },
      // Full state machine lives entirely in lib/seller-store.js — every
      // value it ever sets is listed here.
      status: { enum: ['held', 'delivered', 'dispute', 'released', 'refunded'] },
    },
  },

  wallets: {
    bsonType: 'object',
    required: ['_id', 'balance'],
    properties: {
      _id: { bsonType: 'string' },
      // Guarded by a $gte conditional filter on every debit — never negative.
      balance: { bsonType: 'number', minimum: 0 },
      ledger: { bsonType: 'array' },
      holds: { bsonType: 'array' },
    },
  },

  reviews: {
    bsonType: 'object',
    required: ['_id', 'dealId', 'sellerEmail', 'rating'],
    properties: {
      _id: { bsonType: 'string' },
      dealId: { bsonType: 'string' },
      sellerEmail: { bsonType: 'string' },
      rating: { bsonType: 'number', minimum: 1, maximum: 5 },
    },
  },

  invites: {
    bsonType: 'object',
    required: ['_id', 'email', 'tokenHash', 'status'],
    properties: {
      _id: { bsonType: 'string' },
      email: { bsonType: 'string' },
      tokenHash: { bsonType: 'string' },
      status: { enum: ['unused', 'used', 'superseded'] },
    },
  },

  stock: {
    bsonType: 'object',
    required: ['_id', 'listingId', 'status', 'iv', 'ct', 'tag'],
    properties: {
      _id: { bsonType: 'string' },
      listingId: { bsonType: 'string' },
      orderId: { bsonType: ['string', 'null'] },
      status: { enum: ['available', 'reserved', 'sold', 'compromised'] },
      iv: { bsonType: 'string' },
      ct: { bsonType: 'string' },
      tag: { bsonType: 'string' },
    },
  },

  email_verifications: {
    bsonType: 'object',
    required: ['_id', 'codeHash', 'expiresAt'],
    properties: {
      _id: { bsonType: 'string' },
      codeHash: { bsonType: 'string' },
      expiresAt: { bsonType: 'date' },
      attempts: { bsonType: 'number' },
    },
  },

  conversations: {
    bsonType: 'object',
    required: ['_id', 'buyerEmail', 'sellerEmail', 'participants'],
    properties: {
      _id: { bsonType: 'string' },
      buyerEmail: { bsonType: 'string' },
      sellerEmail: { bsonType: 'string' },
      participants: { bsonType: 'array' },
    },
  },

  messages: {
    bsonType: 'object',
    required: ['_id', 'conversationId'],
    properties: {
      _id: { bsonType: 'string' },
      conversationId: { bsonType: 'string' },
    },
  },

  states: {
    bsonType: 'object',
    required: ['_id'],
    properties: {
      _id: { bsonType: 'string' },
    },
  },
};

/**
 * Apply every schema in `schemas` to its same-named collection on `db`.
 * Best-effort: a validator is a safety net, not a boot gate, so a failure
 * here is logged and swallowed rather than blocking startup (unlike the
 * money-guarding unique indexes in ensureIndexes, which do fail boot).
 */
async function applySchemas(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  for (const [name, schema] of Object.entries(schemas)) {
    const validator = { $jsonSchema: schema };
    try {
      if (existing.has(name)) {
        await db.command({
          collMod: name,
          validator,
          validationLevel: 'moderate',
          validationAction: 'error',
        });
      } else {
        await db.createCollection(name, { validator, validationLevel: 'moderate', validationAction: 'error' });
      }
    } catch (e) {
      console.warn(`   schema warn (${name}):`, e.message);
    }
  }
}

module.exports = { schemas, applySchemas };
