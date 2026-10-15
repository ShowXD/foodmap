import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import * as link from '../functions/api/link.js';
import * as lists from '../functions/api/lists.js';
import * as members from '../functions/api/list-members.js';
import { readCookie } from '../lib/links.js';

test('readCookie decodes values and ignores a malformed one instead of throwing', () => {
  const withCookie = (cookie) => new Request('https://example.test/', { headers: { Cookie: cookie } });
  assert.equal(readCookie(withCookie('a=1; foodmap_link=x%20y'), 'foodmap_link'), 'x y');
  assert.equal(readCookie(withCookie('foodmap_link=%'), 'foodmap_link'), null);
  assert.equal(readCookie(withCookie('other=1'), 'foodmap_link'), null);
});

// Runs a request through the real middleware as `email` (DEV_USER_EMAIL works on localhost only),
// optionally carrying the link cookie, and lets `handler` act as the route.
async function as(DB, email, { handler, method = 'GET', body, cookie } = {}) {
  const headers = cookie ? { Cookie: `foodmap_link=${cookie}` } : {};
  const request = new Request('http://localhost:8788/api/link', { method, headers, body: body && JSON.stringify(body) });
  const context = { request, env: { DB, DEV_USER_EMAIL: email }, data: {} };
  context.next = async () => (handler ? handler(context) : new Response('ok'));
  const response = await middleware(context);
  const setCookies = response.headers.getSetCookie();
  return { response, user: context.data.user, setCookies, body: handler ? await response.clone().json() : null };
}

async function startLinkAs(DB, email) {
  const started = await as(DB, email, { handler: link.onRequestPost, method: 'POST' });
  const cookie = started.setCookies.find((value) => value.startsWith('foodmap_link='));
  assert.match(cookie, /HttpOnly/);
  return cookie.split(';')[0].split('=')[1];
}

test('sign in with the other account while the link cookie is set: both emails become one person', async () => {
  const DB = createTestDb();
  const main = await ensureUser(DB, 'me@example.test', {});
  const token = await startLinkAs(DB, 'me@example.test');

  // Still signed in as the account that asked: nothing happens yet and the token stays valid.
  const stillMe = await as(DB, 'me@example.test', { cookie: token });
  assert.deepEqual(stillMe.setCookies, []);

  const linked = await as(DB, 'me.google@gmail.test', { cookie: token });
  assert.equal(linked.user.id, main.id);
  assert.ok(linked.setCookies.some((value) => value.startsWith('foodmap_link=;')), 'link cookie is cleared');
  assert.ok(linked.setCookies.some((value) => value.startsWith('foodmap_link_result=linked')));

  const later = await as(DB, 'me.google@gmail.test');
  assert.equal(later.user.id, main.id, 'from now on that sign-in is the same person');
  const identities = (await as(DB, 'me.google@gmail.test', { handler: link.onRequestGet })).body;
  assert.deepEqual(identities.map((row) => [row.email, row.is_main, row.is_current]), [
    ['me@example.test', true, false],
    ['me.google@gmail.test', false, true],
  ]);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'no second account was created');
});

test('a link token works once, expires, and never merges an account that already exists', async () => {
  const DB = createTestDb();
  const main = await ensureUser(DB, 'me@example.test', {});
  const other = await ensureUser(DB, 'someone@example.test', {});

  const token = await startLinkAs(DB, 'me@example.test');
  const taken = await as(DB, 'someone@example.test', { cookie: token });
  assert.equal(taken.user.id, other.id);
  assert.ok(taken.setCookies.some((value) => value.startsWith('foodmap_link_result=taken')));
  const reused = await as(DB, 'new@example.test', { cookie: token });
  assert.ok(reused.setCookies.some((value) => value.startsWith('foodmap_link_result=expired')), 'used tokens are gone');
  assert.notEqual(reused.user.id, main.id);

  const stale = await startLinkAs(DB, 'me@example.test');
  DB.sqlite.exec("UPDATE link_requests SET expires_at = datetime('now', '-1 minute')");
  const late = await as(DB, 'late@example.test', { cookie: stale });
  assert.notEqual(late.user.id, main.id);
  assert.ok(late.setCookies.some((value) => value.startsWith('foodmap_link_result=expired')));
});

test('unlinking: not the sign-in in use; afterwards that email is a separate new account', async () => {
  const DB = createTestDb();
  const main = await ensureUser(DB, 'me@example.test', {});
  await as(DB, 'me.google@gmail.test', { cookie: await startLinkAs(DB, 'me@example.test') });

  const refused = await as(DB, 'me.google@gmail.test', { handler: link.onRequestDelete, method: 'DELETE', body: { email: 'me.google@gmail.test' } });
  assert.equal(refused.response.status, 400);
  const removed = await as(DB, 'me@example.test', { handler: link.onRequestDelete, method: 'DELETE', body: { email: 'me.google@gmail.test' } });
  assert.equal(removed.response.status, 200);
  assert.notEqual((await as(DB, 'me.google@gmail.test')).user.id, main.id);
});

test('adding a group member by a linked email adds the person behind it', async () => {
  const DB = createTestDb();
  // Adding by email is a site-admin tool.
  const owner = await ensureUser(DB, 'owner@example.test', { ADMIN_EMAILS: 'owner@example.test' });
  const friend = await ensureUser(DB, 'friend@example.test', {});
  await as(DB, 'friend.alt@gmail.test', { cookie: await startLinkAs(DB, 'friend@example.test') });

  const call = async (handler, body) => (await handler({ request: new Request('https://example.test/api', { method: 'POST', body: JSON.stringify(body) }), env: { DB }, data: { user: owner } })).json();
  const group = await call(lists.onRequestPost, { name: '朋友團' });
  const added = await call(members.onRequestPost, { list_id: group.id, email: 'friend.alt@gmail.test' });
  assert.deepEqual([added.user_id, added.email], [friend.id, 'friend@example.test']);
});
