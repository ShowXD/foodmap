import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAccessJwt, resetJwksCacheForTests } from '../lib/access.js';
import { ensureUser } from '../lib/users.js';
import { onRequest } from '../functions/_middleware.js';

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

test('refetches certs once when the signing key rotated', async () => {
  let calls = 0;
  const rotatingFetch = async () => {
    calls++;
    return Response.json({ keys: calls === 1 ? [] : [publicJwk] });
  };
  resetJwksCacheForTests();
  const payload = await verifyAccessJwt(await signJwt(), { teamDomain: TEAM, audiences: [AUD], now: NOW, fetchImpl: rotatingFetch });
  assert.equal(payload.email, 'Mom@Example.com');
  assert.equal(calls, 2);
});

function fakeDb(users = []) {
  return {
    users,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.startsWith('SELECT * FROM users WHERE email')) return users.find((user) => user.email === args[0]) ?? null;
              if (sql.startsWith('INSERT INTO users')) {
                const user = { id: users.length + 1, email: args[0], status: args[1], is_admin: args[2] };
                users.push(user);
                return user;
              }
              if (sql.startsWith('UPDATE users')) {
                const user = users.find((candidate) => candidate.id === args[0]);
                Object.assign(user, { status: 'approved', is_admin: 1 });
                return user;
              }
              throw new Error(`unexpected SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test('ensureUser creates pending users and bootstraps admins from ADMIN_EMAILS', async () => {
  const db = fakeDb();
  const env = { ADMIN_EMAILS: ' Me@Example.com , ' };
  assert.equal((await ensureUser(db, 'kid@example.com', env)).status, 'pending');
  const admin = await ensureUser(db, 'me@example.com', env);
  assert.deepEqual([admin.status, admin.is_admin], ['approved', 1]);

  db.users.push({ id: 9, email: 'late@example.com', status: 'pending', is_admin: 0 });
  const promoted = await ensureUser(db, 'late@example.com', { ADMIN_EMAILS: 'late@example.com' });
  assert.deepEqual([promoted.status, promoted.is_admin], ['approved', 1]);
});

const NEXT = new Response('next');
function runMiddleware(url, env, headers = {}) {
  const context = { request: new Request(url, { headers }), env, next: async () => NEXT, data: {} };
  return onRequest(context).then((response) => ({ response, user: context.data.user }));
}

test('middleware fails closed and never trusts DEV_USER_EMAIL outside localhost', async () => {
  const db = fakeDb([{ id: 1, email: 'me@example.com', status: 'approved', is_admin: 1 }]);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/api/line/webhook', {})).response, NEXT);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/', { DB: db })).response.status, 503);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/', { DB: db, DEV_USER_EMAIL: 'me@example.com' })).response.status, 503);

  const configured = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DEV_USER_EMAIL: 'me@example.com' };
  assert.equal((await runMiddleware('https://foodmap.pages.dev/api/places', configured)).response.status, 401);
  assert.equal((await runMiddleware('https://foodmap.pages.dev/', configured, { 'Cf-Access-Jwt-Assertion': 'forged' })).response.status, 401);
});

test('middleware lets approved users through and parks everyone else on /pending', async () => {
  const db = fakeDb([
    { id: 1, email: 'me@example.com', status: 'approved', is_admin: 1 },
    { id: 2, email: 'kid@example.com', status: 'pending', is_admin: 0 },
  ]);
  const asUser = (email) => ({ DB: db, DEV_USER_EMAIL: email });

  const approved = await runMiddleware('http://localhost:8788/api/places', asUser('ME@example.com'));
  assert.equal(approved.response, NEXT);
  assert.equal(approved.user.email, 'me@example.com');

  assert.equal((await runMiddleware('http://localhost:8788/api/places', asUser('kid@example.com'))).response.status, 403);
  const page = (await runMiddleware('http://localhost:8788/', asUser('kid@example.com'))).response;
  assert.equal(page.status, 302);
  assert.equal(new URL(page.headers.get('Location')).pathname, '/pending');
  assert.equal((await runMiddleware('http://localhost:8788/api/me', asUser('kid@example.com'))).response, NEXT);

  const stranger = await runMiddleware('http://localhost:8788/', asUser('stranger@example.com'));
  assert.equal(stranger.response.status, 302);
  assert.equal(stranger.user.status, 'pending');
});
