# Dot Marketplace

Escrow-protected digital goods marketplace. Node/Express backend (MongoDB or
an in-memory store for local dev), vanilla-JS frontend across three surfaces:

- **Marketplace** (`public/index.html`) — buyer-facing storefront, wallet, deals, chat, forum.
- **Seller portal** (`public/seller/`) — listings, orders, balance, withdrawals.
- **Admin portal** (`public/admin/`) — seller verification, withdrawals, dispute arbitration, payments/orders oversight.

Money never moves on the client's word: the server always re-derives amounts
and seller identity from the listing/payment record, escrow is a real state
machine (`held → delivered → released` or `→ dispute → released|refunded`),
and stock credentials are encrypted at rest.

## Quick start (local dev, no MongoDB)

```bash
npm install
ALLOW_MEMORY_STORE=true DEMO_AUTH=true npm start
```

> If your `.env` is the production one (`NODE_ENV=production`), the guard in
> `validateEnv()` refuses `DEMO_AUTH` — override the environment for local dev:
> ```bash
> ALLOW_MEMORY_STORE=true DEMO_AUTH=true NODE_ENV=development npm start
> ```

Then open:
- Marketplace: http://localhost:3000/
- Seller portal: http://localhost:3000/manage-dev/seller/
- Admin portal: http://localhost:3000/manage-dev/admin/ (`admin@dot.market` / `test12345`, or set `ADMIN_PASSWORD`)

`ALLOW_MEMORY_STORE=true` runs entirely in an in-memory store — nothing
persists across restarts, and no database setup is needed. `DEMO_AUTH=true`
additionally enables local-only conveniences (passwordless demo seller
sign-in, simulated wallet top-ups when no payment provider is configured).
**Never set either in production.**

## Quick start (with MongoDB)

```bash
npm run db:up          # starts a local Mongo container
cp .env.example .env   # if present, or create .env — see Configuration below
npm start
npm run db:down        # stop the container when done
```

## Configuration

All configuration is via environment variables (or a `.env` file, loaded via
`dotenv`). Nothing is required to run locally with `ALLOW_MEMORY_STORE=true`;
everything below matters once you point at a real database or go to
production.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. Required unless `ALLOW_MEMORY_STORE=true`. |
| `ALLOW_MEMORY_STORE` | `true` to run without MongoDB (dev only). |
| `PORT` | HTTP port (default `3000`). |
| `NODE_ENV` | `production` enables stricter config validation (see below). |
| `PUBLIC_URL` | The public https origin — used for payment callback URLs. Should not be `localhost` in production. |
| `TRUST_PROXY` | `true` if running behind a reverse proxy that sets `X-Forwarded-For`. |
| `PORTAL_SECRET_PATH` | Path prefix that gates the seller/admin portals (e.g. `/manage-dev/...`). Change this before going live — it's the only thing standing between the public internet and the admin login form. |
| `PORTAL_ALLOWED_IPS`, `PORTAL_DISABLE` | Optional extra portal access restrictions. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap admin account. `ADMIN_PASSWORD` is required in production — the default is a world-known demo password. |
| `DEMO_AUTH` | Local-only auth/payment shortcuts. **Forbidden in production**, enforced by `validateEnv()`. |
| `SESSION_TTL_DAYS` | How long a session token stays valid after signin (default 30). |
| `STOCK_SECRET`, `STOCK_SECRET_OLD` | AES-256-GCM key encrypting stocked credential inventory at rest. Required in production; `_OLD` supports key rotation without invalidating existing stock. |
| `PAYMENT_PROVIDER` | `oxapay` (default) or `cryptomus`. |
| `OXAPAY_MERCHANT_API_KEY` (or `OXAPAY_API_KEY`), `OXAPAY_SANDBOX`, `OXAPAY_FEE_PERCENT` | OxaPay crypto checkout. Without a key, the app runs wallet-only (no crypto deposits/checkout). |
| `CRYPTOMUS_MERCHANT_ID`, `CRYPTOMUS_API_KEY`, `CRYPTOMUS_FEE_PERCENT` | Cryptomus, if used as the provider instead. |
| `PLATFORM_FEE_PERCENT` | Marketplace's cut of each sale. |
| `PAYMENT_PENDING_TTL_MS` | How long a pending crypto invoice stays payable before expiring. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Outbound email (verification codes, notifications). Without SMTP configured, verification codes are returned in the API response instead (dev convenience). |

On boot, `validateEnv()` fails fast with a clear error if a required variable
is missing, and warns (without blocking startup) about risky-but-not-fatal
config like a `localhost` `PUBLIC_URL` in production.

## Scripts

| Command | Does |
|---|---|
| `npm start` | Run the server. |
| `npm test` | Run the test suite (`node --test`) against a spawned in-memory server instance — see [Testing](#testing). |
| `npm run seed` | Seed demo accounts, listings, and an admin account (in that order). |
| `npm run db:up` / `npm run db:down` | Start/stop a local MongoDB container via Docker. |
| `npm run db:check` | Sanity-check the MongoDB connection. |

`scripts/logic-check.js` is a standalone manual integration script (point
`BASE` at a running server) — useful for a quick end-to-end sanity pass
against a real deployment; it's separate from the automated `npm test` suite.

## Testing

```bash
npm test
```

Each test file spawns a real `server.js` process on the in-memory store and
drives it over HTTP — the same surface a browser hits — rather than testing
internals in isolation. This catches the class of bug this codebase has
actually shipped: a backend endpoint that works but the frontend never calls
correctly (or vice versa), not just broken business logic. Coverage focuses
on the money-critical paths: wallet top-up → escrow hold → deliver → release,
dispute → admin resolve (release/refund), withdrawal approval's tx-hash
requirement, and seller verification.

There's no CI-only test database to manage — tests always run against
`ALLOW_MEMORY_STORE=true`, regardless of your local `.env`.

## Deployment

`scripts/deploy-vps.sh` / `scripts/upload-to-vps.sh` target a single VPS
running the app directly under Node (no containerization). Uploaded images
(chat, listings) are stored on local disk under `public/uploads/` — fine for
a single persistent instance, but they won't survive an ephemeral filesystem
or be shared across multiple instances if you ever scale horizontally.
Rate limiting is likewise in-memory per process, not shared across instances.

## Architecture notes

- **Auth**: bearer tokens (no cookies/sessions), rotated on every signin,
  expiring after `SESSION_TTL_DAYS`. No refresh-token flow — an expired
  token just requires signing in again.
- **Storage**: `lib/*-store.js` modules abstract over MongoDB vs. the
  in-memory `Map`-based store behind the same interface, selected once at
  boot based on `MONGODB_URI`/`ALLOW_MEMORY_STORE`.
- **Escrow**: `lib/seller-store.js` owns the state machine; wallet and crypto
  payments both fund the same `holdEscrow` path so delivery/dispute/release
  logic doesn't need to know which payment method funded the deal.
- **Portals**: the seller and admin frontends are served only under
  `PORTAL_SECRET_PATH`, never at a guessable path — see `lib/portal-access.js`.
