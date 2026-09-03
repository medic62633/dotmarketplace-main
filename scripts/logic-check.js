#!/usr/bin/env node
/* Quick logic/integration checks for dot-marketplace APIs */
const http = require('http');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;

function req(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(u, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (_) {}
        resolve({ status: res.statusCode, json, raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function signIn(email, password) {
  const r = await req('POST', '/api/auth/signin', { body: { email, password } });
  if (r.status !== 200 || !r.json.token) throw new Error('signin failed ' + email + ': ' + r.raw);
  return r.json.token;
}

function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name); }
}

async function main() {
  console.log('Logic check →', BASE);

  // --- auth gates ---
  const anonList = await req('GET', '/api/seller/dashboard');
  ok('seller dashboard rejects anon', anonList.status === 401);

  const anonAdmin = await req('GET', '/api/admin/dashboard');
  ok('admin dashboard rejects anon', anonAdmin.status === 401);

  const sellerTok = await signIn('anna.pixel@sellers.dot.market', 'test12345');
  const adminTok = await signIn('admin@dot.market', 'test12345');

  const sellerOnAdmin = await req('GET', '/api/admin/dashboard', { token: sellerTok });
  ok('admin dashboard rejects seller', sellerOnAdmin.status === 403);

  // --- listing + image ---
  const create = await req('POST', '/api/seller/listings', {
    token: sellerTok,
    body: { cat: 'digital', title: 'Logic test listing', desc: 'Automated test', price: 12.5, status: 'draft', imageData: IMG },
  });
  ok('create listing with image', create.status === 200 && create.json.listing?.image?.startsWith('/uploads/listings/'));
  const lid = create.json.listing?.id;

  const imgUrl = create.json.listing?.image;
  const imgGet = await req('GET', imgUrl);
  ok('listing image served statically', imgGet.status === 200);

  const updateRemove = await req('PUT', '/api/seller/listings/' + lid, {
    token: sellerTok,
    body: { image: null },
  });
  ok('remove listing image', updateRemove.status === 200 && updateRemove.json.listing?.image == null);

  const updateReadd = await req('PUT', '/api/seller/listings/' + lid, {
    token: sellerTok,
    body: { imageData: IMG },
  });
  ok('re-add listing image', updateReadd.status === 200 && updateReadd.json.listing?.image);

  const badImg = await req('POST', '/api/seller/listings', {
    token: sellerTok,
    body: { cat: 'digital', title: 'Bad img', desc: 'x', price: 5, status: 'draft', image: 'https://evil.com/x.jpg' },
  });
  ok('reject external image URL on create', badImg.status === 400);

  const invalidData = await req('POST', '/api/seller/listings', {
    token: sellerTok,
    body: { cat: 'digital', title: 'Bad data', desc: 'x', price: 5, status: 'draft', imageData: 'not-an-image' },
  });
  ok('reject invalid imageData', invalidData.status === 400);

  // --- verification gate ---
  const unverifiedTok = await signIn('kazuto@sellers.dot.market', 'test12345');
  const pubAttempt = await req('POST', '/api/seller/listings', {
    token: unverifiedTok,
    body: { cat: 'gaming', title: 'Unverified pub', desc: 'Should fail', price: 10, status: 'active' },
  });
  ok('unverified seller cannot publish active', pubAttempt.status === 403);

  // --- public listings only verified + active ---
  await req('PUT', '/api/seller/listings/' + lid, { token: sellerTok, body: { status: 'active' } });
  const pub = await req('GET', '/api/listings');
  const inPublic = (pub.json.listings || []).some(l => l.id === lid);
  ok('active verified listing appears publicly', inPublic);
  ok('public listing includes image field when set', (pub.json.listings || []).find(l => l.id === lid)?.image);

  // --- ownership ---
  const otherSeller = await signIn('devraj.s@sellers.dot.market', 'test12345');
  const hijack = await req('PUT', '/api/seller/listings/' + lid, { token: otherSeller, body: { title: 'Hacked' } });
  ok('other seller cannot edit listing', hijack.status === 404);

  // --- withdrawal flow ---
  const dash = await req('GET', '/api/seller/dashboard', { token: sellerTok });
  const bal = dash.json.profile?.balance || 0;
  if (bal >= 10) {
    const wd = await req('POST', '/api/seller/withdrawals', {
      token: sellerTok,
      body: { amount: 10, address: 'TXyz123456789012345678901234567890' },
    });
    ok('withdrawal deducts balance', wd.status === 200 && wd.json.profile.balance <= bal - 10);
    const wdId = wd.json.withdrawal?.id;
    const reject = await req('POST', '/api/admin/withdrawals/' + wdId + '/reject', { token: adminTok });
    ok('admin reject refunds balance', reject.status === 200);
    const dash2 = await req('GET', '/api/seller/dashboard', { token: sellerTok });
    ok('balance restored after reject', dash2.json.profile.balance >= bal - 0.01);
  } else {
    console.log('  ~ skip withdrawal test (balance < 10)');
  }

  // --- admin seller verify ---
  const sellers = await req('GET', '/api/admin/sellers', { token: adminTok });
  ok('admin lists sellers', sellers.status === 200 && Array.isArray(sellers.json.sellers));

  // --- escrow + payout flow (payout must be backed by a recorded escrow) ---
  const buyerTok = await signIn('alex.buyer@test.com', 'test12345');
  const dealId = 'TEST-DUP-' + Date.now();
  const hold = await req('POST', '/api/seller/escrow-hold', {
    token: buyerTok,
    body: { dealId, amount: 50, sellerEmail: 'anna.pixel@sellers.dot.market', listingTitle: 'Test', method: 'wallet' },
  });
  ok('buyer can open a wallet escrow hold', hold.status === 200);

  const payoutNoEscrow = await req('POST', '/api/seller/payout', {
    token: buyerTok,
    body: { dealId: 'TEST-NO-ESCROW-' + Date.now() },
  });
  ok('payout without escrow is rejected', payoutNoEscrow.status === 404);

  const foreignPayout = await req('POST', '/api/seller/payout', {
    token: sellerTok,
    body: { dealId },
  });
  ok('only funding buyer can release escrow', foreignPayout.status === 403);

  const payout1 = await req('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });
  const payout2 = await req('POST', '/api/seller/payout', { token: buyerTok, body: { dealId } });
  ok('escrow payout releases once', payout1.status === 200 && payout1.json.duplicate !== true);
  ok('duplicate payout idempotent', payout2.json.duplicate === true);

  // cleanup test listing
  await req('DELETE', '/api/seller/listings/' + lid, { token: sellerTok });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
