import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_COOKIE, createSessionValue, isValidSession, onRequestPost } from '../functions/api/login.js';
import { onRequest } from '../functions/_middleware.js';

const env = { FAMILY_PASSWORD: 'test family password', SESSION_SECRET: 'test-session-secret' };
const NEXT = new Response('next');

function runMiddleware(path, { cookie, secrets = env } = {}) {
  const headers = cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {};
  return onRequest({ request: new Request(`https://example.test${path}`, { headers }), env: secrets, next: async () => NEXT });
}

function login(password, secrets = env) {
  const body = new URLSearchParams({ password });
  return onRequestPost({ request: new Request('https://example.test/api/login', { method: 'POST', body }), env: secrets });
}

test('session cookie is valid until it expires or is tampered with', async () => {
  const now = Date.now();
  const value = await createSessionValue(env, now);
  assert.equal(await isValidSession(env, value, now), true);
  assert.equal(await isValidSession(env, value, now + 31 * 24 * 60 * 60 * 1000), false);
  const [expiresAt, signature] = value.split('.');
  assert.equal(await isValidSession(env, `${Number(expiresAt) + 1}.${signature}`, now), false);
  assert.equal(await isValidSession(env, 'garbage', now), false);
  assert.equal(await isValidSession(env, null, now), false);
});

test('changing the family password invalidates existing sessions', async () => {
  const value = await createSessionValue(env);
  assert.equal(await isValidSession({ ...env, FAMILY_PASSWORD: 'new password' }, value), false);
});

test('middleware blocks anonymous requests and fails closed without secrets', async () => {
  assert.equal(await runMiddleware('/login'), NEXT);
  assert.equal(await runMiddleware('/api/line/webhook', { secrets: {} }), NEXT);

  const page = await runMiddleware('/');
  assert.equal(page.status, 302);
  assert.equal(new URL(page.headers.get('Location')).pathname, '/login');
  assert.equal((await runMiddleware('/api/places')).status, 401);
  assert.equal((await runMiddleware('/app.js', { cookie: 'forged.cookie' })).status, 302);
  assert.equal((await runMiddleware('/', { secrets: { FAMILY_PASSWORD: 'only one' } })).status, 503);

  assert.equal(await runMiddleware('/api/places', { cookie: await createSessionValue(env) }), NEXT);
});

test('login sets a secure cookie only for the right password', async () => {
  const ok = await login('test family password');
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('Location'), '/');
  const cookie = ok.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const value = cookie.split(';')[0].slice(`${SESSION_COOKIE}=`.length);
  assert.equal(await isValidSession(env, value), true);

  const wrong = await login('wrong');
  assert.equal(wrong.headers.get('Location'), '/login?error=1');
  assert.equal(wrong.headers.get('Set-Cookie'), null);

  assert.equal((await login('anything', {})).status, 503);
});
