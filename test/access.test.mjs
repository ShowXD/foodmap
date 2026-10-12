import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAccessJwt, resetJwksCacheForTests } from '../lib/access.js';
import { ensureUser } from '../lib/users.js';
import { onRequest } from '../functions/_middleware.js';
import { createTestDb } from './d1.mjs';

const TEAM = 'https://family.cloudflareaccess.com';
const AUD = 'aud-production';
const NOW = Date.UTC(2026, 9, 12, 8, 0, 0);
const NOW_SECONDS = NOW / 1000;

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'key-1', alg: 'RS256' };

const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64url');
const encodeJson = (value) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

async function signJwt(payloadOverrides = {}, headerOverrides = {}) {
  const header = encodeJson({ alg: 'RS256', kid: 'key-1', ...headerOverrides });
  const payload = encodeJson({ iss: TEAM, aud: [AUD], email: 'Mom@Example.com', exp: NOW_SECONDS + 600, iat: NOW_SECONDS, ...payloadOverrides });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

const fetchCerts = async () => Response.json({ keys: [publicJwk] });
const verify = (token, overrides = {}) => {
  resetJwksCacheForTests();
  return verifyAccessJwt(token, { teamDomain: 'family.cloudflareaccess.com', audiences: [AUD], now: NOW, fetchImpl: fetchCerts, ...overrides });
};

test('accepts a valid Access JWT', async () => {
  const payload = await verify(await signJwt());
  assert.equal(payload.email, 'Mom@Example.com');
});

test('rejects tokens for another app, another team, expired, or not yet valid', async () => {
  assert.equal(await verify(await signJwt({ aud: ['someone-elses-app'] })), null);
  assert.equal(await verify(await signJwt({ iss: 'https://evil.cloudflareaccess.com' })), null);
  assert.equal(await verify(await signJwt({ exp: NOW_SECONDS - 1 })), null);
  assert.equal(await verify(await signJwt({ nbf: NOW_SECONDS + 60 })), null);
  assert.equal(await verify(await signJwt({ email: undefined })), null);
});

test('rejects forged, tampered, unsigned, and malformed tokens', async () => {
  const [header, , signature] = (await signJwt()).split('.');
  const tamperedPayload = encodeJson({ iss: TEAM, aud: [AUD], email: 'attacker@example.com', exp: NOW_SECONDS + 600 });
  assert.equal(await verify(`${header}.${tamperedPayload}.${signature}`), null);
  assert.equal(await verify(await signJwt({}, { alg: 'none' })), null);
  assert.equal(await verify(await signJwt({}, { kid: 'unknown-key' })), null);
  assert.equal(await verify('not-a-jwt'), null);
  assert.equal(await verify(null), null);
  assert.equal(await verify(await signJwt(), { audiences: [] }), null);
});

test('refetches certs for a rotated key, but at most once a minute', async () => {
  let calls = 0;
  const rotatingFetch = async () => {
    calls++;
    return Response.json({ keys: calls === 1 ? [] : [publicJwk] });
  };
  resetJwksCacheForTests();
  const options = { teamDomain: TEAM, audiences: [AUD], fetchImpl: rotatingFetch };
  // Cached set (no key-1) is younger than a minute: no forced refetch yet.
  assert.equal(await verifyAccessJwt(await signJwt(), { ...options, now: NOW }), null);
  assert.equal(await verifyAccessJwt(await signJwt(), { ...options, now: NOW + 30_000 }), null);
  assert.equal(calls, 1);
  const payload = await verifyAccessJwt(await signJwt(), { ...options, now: NOW + 61_000 });
  assert.equal(payload.email, 'Mom@Example.com');
  assert.equal(calls, 2);
});

test('malformed signatures and an unreachable certs endpoint deny instead of throwing', async () => {
  const [header, payload] = (await signJwt()).split('.');
  assert.equal(await verify(`${header}.${payload}.not*base64!`), null);
  resetJwksCacheForTests();
  const failingFetch = async () => new Response('down', { status: 503 });
  assert.equal(await verifyAccessJwt(await signJwt(), { teamDomain: TEAM, audiences: [AUD], now: NOW, fetchImpl: failingFetch }), null);
});

function dbWithUsers(rows = []) {
  const db = createTestDb();
  for (const { email, status, is_admin: isAdmin } of rows) {
    db.sqlite.prepare('INSERT INTO users (email, status, is_admin) VALUES (?, ?, ?)').run(email, status, isAdmin);
  }
  return db;
}

test('ensureUser opens registration and bootstraps admins from ADMIN_EMAILS', async () => {
  const db = dbWithUsers();
  const env = { ADMIN_EMAILS: ' Me@Example.com , ' };
  const kid = await ensureUser(db, 'kid@example.com', env);
  assert.deepEqual([kid.status, kid.is_admin], ['approved', 0]);
  const admin = await ensureUser(db, 'me@example.com', env);
  assert.deepEqual([admin.status, admin.is_admin], ['approved', 1]);
  assert.equal((await ensureUser(db, 'kid@example.com', env)).id, kid.id);

  db.sqlite.prepare("INSERT INTO users (email, status, is_admin) VALUES ('late@example.com', 'disabled', 0)").run();
  const promoted = await ensureUser(db, 'late@example.com', { ADMIN_EMAILS: 'late@example.com' });
  assert.deepEqual([promoted.status, promoted.is_admin], ['approved', 1]);
});

// next() returns this marker body so tests can tell "passed through" from any blocking response.
const PASSED = 'reached-next';
async function runMiddleware(url, env, headers = {}, method = 'GET') {
  const context = { request: new Request(url, { headers, method }), env, next: async () => new Response(PASSED), data: {} };
  const response = await onRequest(context);
  return { response, passed: (await response.clone().text()) === PASSED, user: context.data.user };
}

test('middleware fails closed and never trusts DEV_USER_EMAIL outside localhost', async () => {
  const db = dbWithUsers([{ email: 'me@example.com', status: 'approved', is_admin: 1 }]);
  assert.ok((await runMiddleware('https://foodmap.pages.dev/api/line/webhook', {})).passed);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/', { DB: db })).response.status, 503);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/', { DB: db, DEV_USER_EMAIL: 'me@example.com' })).response.status, 503);

  const configured = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DEV_USER_EMAIL: 'me@example.com' };
  assert.equal((await runMiddleware('https://foodmap.pages.dev/api/places', configured)).response.status, 401);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/', configured, { 'Cf-Access-Jwt-Assertion': 'forged' })).response.status, 401);
});

test('middleware lets every signed-in user through and parks only disabled accounts on /pending', async () => {
  const db = dbWithUsers([
    { email: 'me@example.com', status: 'approved', is_admin: 1 },
    { email: 'banned@example.com', status: 'disabled', is_admin: 0 },
  ]);
  const asUser = (email) => ({ DB: db, DEV_USER_EMAIL: email });

  const approved = await runMiddleware('http://localhost:8788/api/places', asUser('ME@example.com'));
  assert.ok(approved.passed);
  assert.equal(approved.user.email, 'me@example.com');

  const stranger = await runMiddleware('http://localhost:8788/', asUser('stranger@example.com'));
  assert.ok(stranger.passed);
  assert.equal(stranger.user.status, 'approved');

  assert.equal((await runMiddleware('http://localhost:8788/api/places', asUser('banned@example.com'))).response.status, 403);
  const page = (await runMiddleware('http://localhost:8788/', asUser('banned@example.com'))).response;
  assert.equal(page.status, 302);
  assert.equal(new URL(page.headers.get('Location')).pathname, '/pending');
  assert.ok((await runMiddleware('http://localhost:8788/api/me', asUser('banned@example.com'))).passed);

  // Leftover 'pending' rows from the approval era are blocked, not treated as approved.
  db.sqlite.prepare("INSERT INTO users (email, status, is_admin) VALUES ('legacy@example.com', 'pending', 0)").run();
  assert.equal((await runMiddleware('http://localhost:8788/api/places', asUser('legacy@example.com'))).response.status, 403);
});

test('middleware blocks cross-site writes but allows same-origin ones', async () => {
  const db = dbWithUsers([{ email: 'me@example.com', status: 'approved', is_admin: 1 }]);
  const env = { DB: db, DEV_USER_EMAIL: 'me@example.com' };
  const url = 'http://localhost:8788/api/list-members';

  assert.equal((await runMiddleware(url, env, { 'Sec-Fetch-Site': 'cross-site' }, 'POST')).response.status, 403);
  assert.equal((await runMiddleware(url, env, { Origin: 'https://evil.example' }, 'POST')).response.status, 403);
  assert.equal((await runMiddleware(url, env, { 'Sec-Fetch-Site': 'same-site' }, 'DELETE')).response.status, 403);
  assert.ok((await runMiddleware(url, env, { 'Sec-Fetch-Site': 'same-origin', Origin: 'http://localhost:8788' }, 'POST')).passed);
  assert.ok((await runMiddleware(url, env, {}, 'POST')).passed);
  // Reads stay allowed so links from other sites (e.g. LINE) still open the app.
  assert.ok((await runMiddleware('http://localhost:8788/', env, { 'Sec-Fetch-Site': 'cross-site' })).passed);
});

test('every response carries security headers and API responses are not cached', async () => {
  const db = dbWithUsers([{ email: 'me@example.com', status: 'approved', is_admin: 1 }]);
  const env = { DB: db, DEV_USER_EMAIL: 'me@example.com' };
  for (const { response } of [
    await runMiddleware('http://localhost:8788/', env),
    await runMiddleware('https://foodmap.pages.dev/', { DB: db }),
  ]) {
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self';/);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  }
  assert.equal((await runMiddleware('http://localhost:8788/api/places', env)).response.headers.get('Cache-Control'), 'no-store');
});
