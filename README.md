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
npm run db:up          # starts a local Mongo container (as a single-node replica set)
cp .env.example .env   # if present, or create .env — see Configuration below
npm start
npm run db:down        # stop the container when done
```

`db:up` runs the container with `--replSet rs0` and initiates it, so
`MONGODB_URI=mongodb://127.0.0.1:27017/dotmarket?replicaSet=rs0` locally —
matching Atlas (always a replica set) closely enough that the transaction-
wrapped money paths (see Architecture notes) actually run transactionally in
local dev too, instead of silently falling back.

## Configuration

All configuration is via environment variables (or a `.env` file, loaded via
`dotenv`). Nothing is required to run locally with `ALLOW_MEMORY_STORE=true`;
everything below matters once you point at a real database or go to
production.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. Required unless `ALLOW_MEMORY_STORE=true`. |
| `ALLOW_MEMORY_STORE` | `true` to run without MongoDB (dev only — **forbidden in production**, enforced by `validateEnv()`, same as `DEMO_AUTH`). A failed `MONGODB_URI` connection is retried with backoff (up to ~60s total) before the app falls back to it outside production, or refuses to boot in production. |
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
| `PAYMENT_PROVIDER` | Empty (default, wallet-only) or one native no-processor chain: `native_tron`, `native_eth`, `native_bsc`, `native_sol`, `native_sol_usdt`, `native_btc`, `native_ltc` (see "Native crypto payments" below). Crypto payments always go directly to the operator's own wallets — there is no external payment processor. |
| `TRONGRID_API_KEY`, `NATIVE_TRON_API_BASE`, `NATIVE_TRON_USDT_CONTRACT`, `NATIVE_TRON_CONFIRM_SECONDS` | Only used when `PAYMENT_PROVIDER=native_tron`. |
| `NATIVE_ETH_RPC_URL`, `NATIVE_ETH_USDT_CONTRACT`, `NATIVE_ETH_USDT_DECIMALS`, `NATIVE_ETH_CONFIRM_SECONDS` | Only used when `PAYMENT_PROVIDER=native_eth`. |
| `NATIVE_BSC_RPC_URL`, `NATIVE_BSC_USDT_CONTRACT`, `NATIVE_BSC_USDT_DECIMALS`, `NATIVE_BSC_CONFIRM_SECONDS` | Only used when `PAYMENT_PROVIDER=native_bsc`. |
| `NATIVE_SOL_RPC_URL`, `NATIVE_SOL_USDT_MINT`, `NATIVE_SOL_CONFIRM_SECONDS` | Only used when `PAYMENT_PROVIDER=native_sol` or `native_sol_usdt`. |
| `NATIVE_BTC_API_BASE`, `NATIVE_BTC_CONFIRM_SECONDS` | Only used when `PAYMENT_PROVIDER=native_btc`. |
| `NATIVE_LTC_API_BASE`, `NATIVE_LTC_CONFIRM_SECONDS` | Only used when `PAYMENT_PROVIDER=native_ltc`. |

All seven `native_*` providers are **unverified against a real chain, and need testnet validation before mainnet** — see "Native crypto payments" below.
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

## Going to production

Copy `.env.example` to `.env` and fill in real values — `.env` itself is
gitignored and must never be committed (this repo's history already has one
example of why: a `.env` was committed once, its secrets are compromised,
and rotating every one of them — Mongo, admin password, SMTP,
`STOCK_SECRET` — plus scrubbing it from git history is the standing
follow-up on this repo; if that hasn't happened yet, treat it as blocking).

With `NODE_ENV=production`, `validateEnv()` fails boot (not just a warning)
if any of these are missing or wrong:

- `ADMIN_PASSWORD` — set, not the "test12345" default
- `STOCK_SECRET` — set, a real random value (see `.env.example`)
- `PORTAL_SECRET_PATH` — set (via `lib/portal-access.js`'s own boot check,
  not `validateEnv()`), an unguessable value
- `DEMO_AUTH` and `ALLOW_MEMORY_STORE` — must NOT be `true`
- `MONGODB_URI` — set, pointing at a real (ideally replica-set — see
  Reliability & outages below) MongoDB

Before flipping real traffic on:

- [ ] `npm run db:verify` against the production `MONGODB_URI` (safe — see
      Reliability & outages)
- [ ] `PUBLIC_URL` is the real `https://` origin
- [ ] A reverse proxy terminates TLS in front of the app (`scripts/deploy-vps.sh`
      sets up nginx + Let's Encrypt) — the app itself speaks plain HTTP
- [ ] `npm run db:backup` is on a cron job (see Backups below)
- [ ] Something polls `GET /healthz` (uptime monitor, PM2 healthcheck) — see
      Reliability & outages
- [ ] If using any `PAYMENT_PROVIDER=native_*`: that specific chain
      testnet-verified first, per "Native crypto payments" below — this is
      custody code, treat it with more suspicion than everything else on
      this list combined

## Deployment

`scripts/deploy-vps.sh` / `scripts/upload-to-vps.sh` target a single VPS
running the app directly under Node (no containerization). Uploaded images
(chat, listings) are stored on local disk under `public/uploads/` — fine for
a single persistent instance, but they won't survive an ephemeral filesystem
or be shared across multiple instances if you ever scale horizontally.
Rate limiting is likewise in-memory per process, not shared across instances.

## Backups

```bash
npm run db:backup                 # dumps MONGODB_URI to backups/dotmarket-<timestamp>.archive.gz
KEEP=30 npm run db:backup         # keep the last 30 backups instead of the default 14
npm run db:restore                # restores the newest backup, merging (upserts by _id)
npm run db:restore -- --drop      # restores the newest backup, replacing collections wholesale
npm run db:restore -- path/to/backup.archive.gz --drop
```

Both scripts read `MONGODB_URI` from `.env` and need the [MongoDB Database
Tools](https://www.mongodb.com/try/download/database-tools) (`mongodump` /
`mongorestore`) installed — on Atlas this backs up/restores over the network;
there's no separate local step. `backups/` is gitignored: a dump is a full
copy of the same money/PII data an accidentally-committed `.env` would leak,
so treat the files themselves as secrets (encrypt them if you ship them off
the VPS) and never commit one. `db:restore` always prints the target host and
requires typing it back to confirm before touching data — there's no
`--yes`/non-interactive flag on purpose.

On the VPS, put `npm run db:backup` on a daily cron job and copy backups off
the host periodically (Atlas also has its own continuous backup — this is
the fast local recovery path for accidental data loss the app itself causes,
e.g. a bad admin action, not a substitute for Atlas's backups).

## Reliability & outages

`GET /healthz` actively pings the database on every call (not just checking
"did we connect once at boot") — `{"ok":true,"db":"mongo"}` means the ping
just succeeded, `{"ok":false,...}` (HTTP 503) means it just failed. Point an
uptime monitor / PM2 healthcheck at this. A mid-session heartbeat failure or
recovery is also logged directly (`⚠ MongoDB heartbeat failed...` /
`✓ MongoDB heartbeat recovered`) independent of traffic, so an outage shows
up in the logs the moment it starts rather than whenever a request happens
to hit it.

**If you're seeing repeated "failed to connect, fell back to memory, lost
data"**, check in this order:

1. **`ALLOW_MEMORY_STORE` in your actual production process** (PM2/systemd
   env, not just the `.env` file) — if it's `true`, that's almost certainly
   the cause; `validateEnv()` now refuses to boot with it set alongside
   `NODE_ENV=production` (previously it silently won). Remove it.
2. **Atlas free tier (M0)**: an M0 cluster is a single node with no replica-
   set failover, and Atlas auto-pauses an M0 cluster after a period of
   inactivity — the next connection has to wait for it to resume, which can
   exceed a short timeout and looks exactly like "randomly fails to
   connect." If you're on M0, either upgrade to a dedicated/serverless tier
   (real replica set, no auto-pause — this is also what makes the
   transaction-wrapped money paths in `lib/seller-store.js` actually run
   transactionally instead of falling back) or keep something hitting the
   cluster periodically so it never pauses.
3. **Atlas Network Access**: if your VPS's IP changed (common on cheap/burst
   VPS providers) and isn't on the allowlist, every connection attempt fails
   the TLS handshake. `npm run db:check` prints your current outbound IP
   when this is the cause.

**If Atlas is genuinely down and you need to get back up fast**: point
`MONGODB_URI` at a local `npm run db:up` Mongo (also a replica set — money
paths stay transactional) and `npm run db:restore` your most recent backup
into it. This is a stopgap to get the app serving again, not a permanent
fix — switch back to Atlas once it recovers, and reconcile whatever wrote
during the gap.

`npm run db:verify` exercises the transaction and schema-validation
machinery (commit, abort-leaves-no-partial-write, and JSON Schema
accept/reject) against your real `MONGODB_URI` on a disposable scratch
collection — safe to run against production, it never touches the app's
real collections. Worth running once after any Mongo version/tier change.

## Native crypto payments (no processor)

`PAYMENT_PROVIDER` can be set to one of seven native (no external
processor, no processor cut) chains — `native_tron` (USDT-TRC20), `native_eth`
(USDT-ERC20), `native_bsc` (USDT-BEP20), `native_sol` (native SOL),
`native_sol_usdt` (USDT-SPL), `native_btc` (Bitcoin), `native_ltc`
(Litecoin). Only one is active at a time — whichever `PAYMENT_PROVIDER` is
set to — but the admin portal's **Crypto** tab manages address pools for
all seven, so switching later is just changing the env var once the new
chain's pool has addresses in it.

Every one works the same way, off a **pre-generated address pool** — the
same pool/claim pattern this codebase already uses for seller credential
stock (`lib/stock-store.js`):

1. You generate real addresses yourself, in your own wallet software for
   that chain (TronLink, MetaMask, a Solana wallet, a Bitcoin/Litecoin
   wallet — whatever you trust). This app **never** generates or holds a
   private key or seed phrase for any chain — only ever paste public
   addresses, on the admin portal's **Crypto** tab (`POST
   /api/admin/crypto-addresses`, `{ network, addresses }`).
2. Each order (wallet top-up or checkout) atomically claims one unfunded
   address from that network's pool — idempotent per order, same address on
   a retry, never handed to two orders (`lib/crypto-address-store.js`, one
   pool shared structurally across all networks, keyed by network).
3. The matching module in `lib/payments/` — `native-tron.js`,
   `native-evm.js` (shared by `native_eth`/`native_bsc`), `native-solana.js`
   (shared by `native_sol`/`native_sol_usdt`), or `native-utxo.js` (shared
   by `native_btc`/`native_ltc`) — polls that chain for a matching transfer
   into the claimed address. Once observed, the order waits out that
   provider's `*_CONFIRM_SECONDS` (a wall-clock stand-in for the chain's own
   block-confirmation count, except Bitcoin/Litecoin, whose esplora-style
   API only reports already-confirmed totals to begin with) before crediting
   the wallet or releasing escrow — via `lib/payment-routes.js`'s
   `markPaid`/`creditDeposit`.
4. None of them have a webhook (nothing to call one) — status is entirely
   poll-driven, off the buyer's own top-up/checkout page.

**None of this has been run against a real chain.** Development happened in
a sandbox with no outbound network access to TronGrid, any Ethereum/BSC
RPC, any Solana RPC, or any Bitcoin/Litecoin explorer — address-pool
claiming (deterministic, offline logic, identical across all seven) is
covered by `test/native-crypto-payments.test.js`, but every provider's
actual `checkAddressForPayment` chain call has only been read against each
chain's documented API, never executed. `lib/payments/native-evm.js`'s
`createInvoice` already needed one bugfix from just trying this locally — a
transient RPC failure at invoice-creation time was making checkout fail
outright instead of degrading gracefully — which is exactly the class of
bug testnet verification exists to catch before it's mainnet money. **Before
pointing any of these at mainnet funds:**

- Testnet-verify that specific chain end to end (Shasta/Nile for TRON;
  Sepolia for Ethereum; BSC Testnet; Solana devnet/testnet; Bitcoin
  testnet/signet; Litecoin testnet) — point the relevant `*_API_BASE` /
  `*_RPC_URL` at the testnet, pool a testnet address, and run a real top-up.
- Have someone else read that chain's provider module and the generic
  `NATIVE_PROVIDERS` dispatch in `lib/payment-routes.js` /
  `lib/wallet-routes.js` before trusting it with money you can't afford to
  lose — this is custody code, not a feature you can patch your way out of
  after the fact.
- Double-check the default `*_API_BASE`/`*_RPC_URL`/contract-or-mint address
  for that chain is actually correct and currently live — several (notably
  `NATIVE_LTC_API_BASE`) were set from documentation/memory, not confirmed
  reachable, because this environment couldn't reach them either.
- Consider whether that provider's `*_CONFIRM_SECONDS` default is
  conservative enough for your risk tolerance; it's a simple, honest proxy
  for chain finality, not a guarantee.

## Architecture notes

- **Auth**: bearer tokens (no cookies/sessions), rotated on every signin,
  expiring after `SESSION_TTL_DAYS`. No refresh-token flow — an expired
  token just requires signing in again.
- **Storage**: `lib/*-store.js` modules abstract over MongoDB vs. the
  in-memory `Map`-based store behind the same interface, selected once at
  boot based on `MONGODB_URI`/`ALLOW_MEMORY_STORE`.
- **Escrow**: `lib/seller-store.js` owns the state machine; wallet and crypto
  payments both fund the same `holdEscrow` path so delivery/dispute/release
  logic doesn't need to know which payment method funded the deal. The
  payout and refund paths (`creditSellerPayout`, `resolveEscrow`'s refund
  branch) run their escrow-state claim and the actual money movement inside
  a real multi-document Mongo transaction (`runTxn`) when the connected
  Mongo is a replica set (Atlas, or a local `db:up` container); on a
  standalone Mongo or the in-memory dev store, they fall back to the same
  sequential atomic writes the app always used, so no deployment loses
  correctness — only some gain stronger crash-safety.
- **Portals**: the seller and admin frontends are served only under
  `PORTAL_SECRET_PATH`, never at a guessable path — see `lib/portal-access.js`.
