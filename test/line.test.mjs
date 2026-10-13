import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { onRequestPost, parseLinks, isValidLineSignature } from '../functions/api/line/webhook.js';
import * as lineGroups from '../functions/api/line-groups.js';

const SECRET = 'test-channel-secret';
const GROUP = 'Cfamilygroup000001';
// Caption fetching would hit the network; pretend IG/FB pages are unreachable.
globalThis.fetch = async () => new Response('', { status: 404 });

async function sign(body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64');
}

function setup(ai) {
  const DB = createTestDb();
  DB.sqlite.exec("INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0)");
  const env = { DB, AI: ai, LINE_CHANNEL_SECRET: SECRET };
  const send = async (events, { signature } = {}) => {
    const body = JSON.stringify({ destination: 'Ubot', events });
    const pending = [];
    const request = new Request('https://example.test/api/line/webhook', {
      method: 'POST',
      body,
      headers: { 'x-line-signature': signature ?? (await sign(body)) },
    });
    const response = await onRequestPost({ request, env, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    return response.status;
  };
  const places = () => DB.sqlite.prepare('SELECT list_id, url, name, dishes, source, line_message_id, created_by FROM places ORDER BY id').all().map((row) => ({ ...row }));
  return { DB, env, send, places };
}

const textEvent = (id, text, source = { type: 'group', groupId: GROUP }) => ({ type: 'message', message: { id, type: 'text', text }, source });
const twoShopsAI = { run: async () => ({ response: { places: [{ name: '阿宗麵線', dishes: '大腸麵線' }, { name: '林東芳', dishes: '牛肉麵' }] } }) };

test('signature: unconfigured 503, forged or missing 401, valid 200', async () => {
  const { env, send } = setup(twoShopsAI);
  assert.equal(await send([], { signature: 'AAAA' }), 401);
  assert.equal(await send([], { signature: 'not base64!!' }), 401);
  assert.equal(await send([]), 200);
  env.LINE_CHANNEL_SECRET = '';
  assert.equal(await send([]), 503);
  assert.equal(await isValidLineSignature(SECRET, '{}', null), false);
});

test('parseLinks keeps only IG/FB links (max 3, no duplicates) and returns the rest as caption', () => {
  const { links, caption } = parseLinks(
    '必吃！https://www.instagram.com/reel/a/ 還有 https://example.com/x https://fb.watch/b https://www.instagram.com/reel/a/ https://m.facebook.com/c https://www.instagram.com/p/d',
  );
  assert.deepEqual(links, ['https://www.instagram.com/reel/a/', 'https://fb.watch/b', 'https://m.facebook.com/c']);
  assert.equal(caption, '必吃！ 還有');
  assert.deepEqual(parseLinks('沒有連結').links, []);
});

test('unbound groups are recorded but nothing is saved', async () => {
  const { DB, send, places } = setup(twoShopsAI);
  assert.equal(await send([textEvent('m1', '好吃 https://www.instagram.com/reel/a/')]), 200);
  assert.deepEqual(places(), []);
  assert.deepEqual({ ...DB.sqlite.prepare('SELECT group_id, list_id FROM line_groups').get() }, { group_id: GROUP, list_id: null });
});

test('bound group: each shop the AI finds is saved once, even if LINE redelivers', async () => {
  const { DB, send, places } = setup(twoShopsAI);
  DB.sqlite.exec(`INSERT INTO line_groups (group_id, list_id) VALUES ('${GROUP}', 1)`);
  const event = textEvent('m2', '台北兩家 https://www.instagram.com/reel/a/');
  await send([event]);
  await send([event]);
  assert.deepEqual(places(), [
    { list_id: 1, url: 'https://www.instagram.com/reel/a/', name: '阿宗麵線', dishes: '大腸麵線', source: 'line', line_message_id: 'm2', created_by: null },
    { list_id: 1, url: 'https://www.instagram.com/reel/a/', name: '林東芳', dishes: '牛肉麵', source: 'line', line_message_id: 'm2', created_by: null },
  ]);
});

test('one list can use at most 20 AI extractions a day; after that links are saved bare', async () => {
  let aiCalls = 0;
  const countingAI = { run: async () => { aiCalls++; return twoShopsAI.run(); } };
  const { DB, send, places } = setup(countingAI);
  DB.sqlite.exec(`INSERT INTO line_groups (group_id, list_id) VALUES ('${GROUP}', 1)`);
  const earlier = Array.from({ length: 20 }, (_, index) => `(1, 'https://fb.watch/old${index}', '舊店', 'line', 'old${index}')`).join(', ');
  DB.sqlite.exec(`INSERT INTO places (list_id, url, name, source, line_message_id) VALUES ${earlier}`);

  await send([textEvent('m9', '好吃 https://www.instagram.com/reel/new/')]);
  assert.equal(aiCalls, 0);
  assert.deepEqual(places().filter((place) => place.line_message_id === 'm9').map((place) => place.name), ['']);
});

test('links are never lost: AI failure or no caption saves the bare link', async () => {
  const failingAI = { run: async () => { throw new Error('quota'); } };
  const { DB, send, places } = setup(failingAI);
  DB.sqlite.exec(`INSERT INTO line_groups (group_id, list_id) VALUES ('${GROUP}', 1)`);
  await send([textEvent('m3', '這家 https://www.instagram.com/reel/x/'), textEvent('m4', 'https://fb.watch/y')]);
  assert.deepEqual(places().map((p) => [p.url, p.name, p.line_message_id]), [
    ['https://www.instagram.com/reel/x/', '', 'm3'],
    ['https://fb.watch/y', '', 'm4'],
  ]);
});

test('unsend removes what was saved from that message; other chats and links are ignored', async () => {
  const { DB, send, places } = setup(twoShopsAI);
  DB.sqlite.exec(`INSERT INTO line_groups (group_id, list_id) VALUES ('${GROUP}', 1)`);
  await send([
    textEvent('m5', 'https://www.instagram.com/reel/a/'),
    textEvent('m6', 'https://example.com/not-social'),
    textEvent('m7', 'https://www.instagram.com/reel/dm/', { type: 'user', userId: 'U1' }),
  ]);
  assert.deepEqual([...new Set(places().map((p) => p.line_message_id))], ['m5']);
  await send([{ type: 'unsend', unsend: { messageId: 'm5' }, source: { type: 'group', groupId: GROUP } }]);
  assert.deepEqual(places(), []);
});

test('only site admins bind LINE groups, and only to group lists', async () => {
  const { DB, send } = setup(twoShopsAI);
  await send([{ type: 'join', source: { type: 'group', groupId: GROUP } }]);
  const admin = await ensureUser(DB, 'admin@example.test', { ADMIN_EMAILS: 'admin@example.test' });
  const kid = await ensureUser(DB, 'kid@example.test', {});
  DB.sqlite.exec(`INSERT INTO lists (id, name, owner_user_id, is_personal) VALUES (2, '我的清單', ${kid.id}, 1)`);
  const patch = async (as, body) => {
    const request = new Request('https://example.test/api/line-groups', { method: 'PATCH', body: JSON.stringify(body) });
    return (await lineGroups.onRequestPatch({ request, env: { DB }, data: { user: as } })).status;
  };
  assert.equal(await patch(kid, { group_id: GROUP, list_id: 1 }), 403);
  assert.equal(await patch(admin, { group_id: GROUP, list_id: 2 }), 400);
  assert.equal(await patch(admin, { group_id: GROUP, list_id: 1 }), 200);
  assert.equal(await patch(admin, { group_id: 'Cunknown', list_id: 1 }), 404);
  const listed = await (await lineGroups.onRequestGet({ request: new Request('https://example.test/api/line-groups'), env: { DB }, data: { user: admin } })).json();
  assert.deepEqual(listed.map((g) => [g.group_id, g.list_name]), [[GROUP, '家人']]);
});
