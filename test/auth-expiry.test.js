const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

test('a session token works immediately and stops working after its TTL elapses', async (t) => {
  // A tiny TTL so the test doesn't need to sleep for real days.
  const srv = await startServer({ SESSION_TTL_DAYS: '0.0001' }); // ~8.6s
  t.after(() => srv.stop());
  const { api } = srv;

  await api('POST', '/api/auth/signup', { body: { email: 'ttl@example.com', password: 'test12345', name: 'TTL' } });
  const signin = await api('POST', '/api/auth/signin', { body: { email: 'ttl@example.com', password: 'test12345' } });
  const token = signin.json.token;

  const fresh = await api('GET', '/api/me', { token });
  assert.equal(fresh.status, 200);

  await new Promise(r => setTimeout(r, 12000));

  const stale = await api('GET', '/api/me', { token });
  assert.equal(stale.status, 401, 'an expired token must be rejected, not treated as a permanent credential');

  // Signing in again issues a fresh, working token.
  const resignin = await api('POST', '/api/auth/signin', { body: { email: 'ttl@example.com', password: 'test12345' } });
  const again = await api('GET', '/api/me', { token: resignin.json.token });
  assert.equal(again.status, 200);
});
