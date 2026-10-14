import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import * as me from '../functions/api/me.js';
import * as avatar from '../functions/api/avatar.js';
import { onRequestGet as getAvatar } from '../functions/avatar/[id].js';
import * as visits from '../functions/api/visits.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup() {
  const DB = createTestDb();
  const mom = await ensureUser(DB, 'mom@example.test', {});
  const call = async (handler, { method = 'GET', body, headers, user = mom, params } = {}) => {
    const request = new Request('https://example.test/api', { method, body, headers });
    // Re-read the user like the middleware does on every request.
    const current = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    return handler({ request, env: { DB }, data: { user: current }, params });
  };
  return { DB, mom, call };
}

test('display name: defaults to none, can be set, and an empty name resets it', async () => {
  const { call } = await setup();
  const profile = async () => (await call(me.onRequestGet)).json();
  assert.deepEqual([(await profile()).name, (await profile()).avatarVersion], [null, null]);

  const patch = (displayName) => call(me.onRequestPatch, { method: 'PATCH', body: JSON.stringify({ display_name: displayName }) });
  assert.equal((await patch(42)).status, 400);
  assert.equal((await patch('x'.repeat(31))).status, 400);
  assert.equal((await patch('  媽媽  ')).status, 200);
  assert.equal((await profile()).name, '媽媽');
  await patch('   ');
  assert.equal((await profile()).name, null);
});

test('photo upload: only real JPEG/PNG/WebP under the size limit; served back and removable', async () => {
  const { mom, call } = await setup();
  const put = (bytes, type) => call(avatar.onRequestPut, { method: 'PUT', body: bytes, headers: { 'Content-Type': type } });
  assert.equal((await put(new TextEncoder().encode('<html>'), 'text/html')).status, 415);
  assert.equal((await put(new TextEncoder().encode('<html>'), 'image/jpeg')).status, 415, 'content must match the claimed type');
  assert.equal((await put(new Uint8Array(300 * 1024 + 1), 'image/jpeg')).status, 413);

  const saved = await put(JPEG, 'image/jpeg');
  assert.equal(saved.status, 200);
  assert.ok((await saved.json()).avatarVersion);
  assert.ok((await (await call(me.onRequestGet)).json()).avatarVersion);

  const served = await call(getAvatar, { params: { id: String(mom.id) } });
  assert.equal(served.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), JPEG);

  await call(avatar.onRequestDelete, { method: 'DELETE' });
  assert.equal((await call(getAvatar, { params: { id: String(mom.id) } })).status, 404);
});

test('a photo is visible to its owner, people in a shared group and site admins only', async () => {
  const { DB, mom, call } = await setup();
  const kid = await ensureUser(DB, 'kid@example.test', {});
  const stranger = await ensureUser(DB, 'stranger@example.test', {});
  const admin = await ensureUser(DB, 'admin@example.test', { ADMIN_EMAILS: 'admin@example.test' });
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id}), (1, ${kid.id})`);
  await call(avatar.onRequestPut, { method: 'PUT', body: JPEG, headers: { 'Content-Type': 'image/jpeg' } });

  const look = async (viewer) => (await call(getAvatar, { user: viewer, params: { id: String(mom.id) } })).status;
  assert.deepEqual([await look(mom), await look(kid), await look(admin), await look(stranger)], [200, 200, 200, 404]);
});

test('family ratings carry each person\'s display name', async () => {
  const { DB, mom } = await setup();
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id});
    INSERT INTO places (id, list_id, url, name) VALUES (10, 1, 'https://fb.watch/a', '阿宗麵線');
    INSERT INTO place_visits (user_id, place_id, rating) VALUES (${mom.id}, 10, 5);
    UPDATE users SET display_name = '媽媽' WHERE id = ${mom.id};`);
  const request = new Request('https://example.test/api/visits?place=10');
  const [visit] = await (await visits.onRequestGet({ request, env: { DB }, data: { user: mom } })).json();
  assert.equal(visit.name, '媽媽');
});
