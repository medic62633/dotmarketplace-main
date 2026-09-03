/* Common test data setup shared across suites: an admin token, a verified
 * seller with a listing, and a funded buyer. Each helper assumes a fresh
 * server instance (from ./server.js) so emails can be constant. */

async function adminToken(api) {
  const r = await api('POST', '/api/auth/signin', { body: { email: 'admin@dot.market', password: 'test12345' } });
  if (r.status !== 200) throw new Error('admin signin failed: ' + JSON.stringify(r.json));
  return r.json.token;
}

async function verifiedSeller(api, adminTok, email, name) {
  const inv = await api('POST', '/api/admin/seller-invites', { token: adminTok, body: { email } });
  if (inv.status !== 200) throw new Error('invite failed: ' + JSON.stringify(inv.json));
  const rawToken = inv.json.setupLink.split('invite=')[1];
  const claim = await api('POST', '/api/seller-invite/claim', { body: { token: rawToken, name, password: 'test12345' } });
  if (claim.status !== 200) throw new Error('claim failed: ' + JSON.stringify(claim.json));
  return claim.json.token;
}

async function listing(api, sellerTok, overrides = {}) {
  const r = await api('POST', '/api/seller/listings', {
    token: sellerTok,
    body: { cat: 'digital', title: 'Test Listing', desc: 'a test listing', price: 25, status: 'active', ...overrides },
  });
  if (r.status !== 200) throw new Error('listing create failed: ' + JSON.stringify(r.json));
  return r.json.listing;
}

async function fundedBuyer(api, email, amount) {
  await api('POST', '/api/auth/signup', { body: { email, password: 'test12345', name: 'Buyer' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email, password: 'test12345' } });
  const token = signin.json.token;
  const topup = await api('POST', '/api/wallet/topup', { token, body: { amount } });
  await api('POST', '/api/wallet/topup/' + topup.json.orderId + '/simulate', { token });
  return token;
}

module.exports = { adminToken, verifiedSeller, listing, fundedBuyer };
