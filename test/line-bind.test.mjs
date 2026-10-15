import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import * as lists from '../functions/api/lists.js';
import * as bindCode from '../functions/api/line-bind-code.js';
import * as lineGroups from '../functions/api/line-groups.js';
import { handleEvent } from '../functions/api/line/webhook.js';

// Social pages are unreachable in tests.
globalThis.fetch = async () => new Response('', { status: 404 });

async function setup() {
  const DB = createTestDb();
  const owner = await ensureUser(DB, 'owner@example.test', {});
  const pal = await ensureUser(DB, 'pal@example.test', {});
  const outsider = await ensureUser(DB, 'outsider@example.test', {});
  const call = async (handler, as, { method = 'POST', query = '', body } = {}) => {
    const request = new Request(`https://example.test/api${query}`, { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env: { DB, LINE_BOT_ID: '@foodmap' }, data: { user: as } });
    return { status: response.status, body: await response.json() };
  };
  const group = (await call(lists.onRequestPost, owner, { body: { name: '朋友團' } })).body;
  DB.sqlite.prepare('INSERT INTO list_members (list_id, user_id) VALUES (?, ?)').run(group.id, pal.id);
  const say = (groupId, text) => handleEvent({ DB }, { type: 'message', message: { id: `m-${Math.random()}`, type: 'text', text }, source: { type: 'group', groupId } });
  const boundTo = (groupId) => DB.sqlite.prepare('SELECT list_id FROM line_groups WHERE group_id = ?').get(groupId)?.list_id ?? null;
  return { DB, owner, pal, outsider, call, group, say, boundTo };
}

test('only the group owner gets a bind code; it is 6 easy-to-read characters with an add-friend link', async () => {
  const { owner, pal, outsider, call, group } = await setup();
  assert.equal((await call(bindCode.onRequestPost, pal, { body: { list_id: group.id } })).status, 404);
  assert.equal((await call(bindCode.onRequestPost, outsider, { body: { list_id: group.id } })).status, 404);
  const issued = await call(bindCode.onRequestPost, owner, { body: { list_id: group.id } });
  assert.equal(issued.status, 201);
  assert.match(issued.body.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(issued.body.add_friend_url, 'https://line.me/R/ti/p/%40foodmap');
});

test('sending「綁定 CODE」in a LINE group binds it once; old, expired and reused codes do nothing', async () => {
  const { DB, owner, call, group, say, boundTo } = await setup();
  const first = (await call(bindCode.onRequestPost, owner, { body: { list_id: group.id } })).body.code;
  const second = (await call(bindCode.onRequestPost, owner, { body: { list_id: group.id } })).body.code;

  await say('Cfriends', `綁定 ${first}`);
  assert.equal(boundTo('Cfriends'), null, 'a newer code cancels the older one');
  await say('Cfriends', `綁定${second.toLowerCase()}`);
  assert.equal(boundTo('Cfriends'), group.id);
  await say('Cother', `綁定 ${second}`);
  assert.equal(boundTo('Cother'), null, 'a code works only once');

  const expired = (await call(bindCode.onRequestPost, owner, { body: { list_id: group.id } })).body.code;
  DB.sqlite.exec("UPDATE line_bind_codes SET expires_at = datetime('now', '-1 minute')");
  await say('Clate', `綁定 ${expired}`);
  assert.equal(boundTo('Clate'), null);
});

test('a LINE group already feeding a list cannot be taken over with someone else\'s code', async () => {
  const { DB, outsider, call, say, boundTo } = await setup();
  DB.sqlite.exec("INSERT INTO lists (id, name, is_personal) VALUES (99, '家人', 0); INSERT INTO line_groups (group_id, list_id) VALUES ('Cfamily', 99)");
  const theirs = (await call(lists.onRequestPost, outsider, { body: { name: '別人的團' } })).body;
  const code = (await call(bindCode.onRequestPost, outsider, { body: { list_id: theirs.id } })).body.code;
  await say('Cfamily', `綁定 ${code}`);
  assert.equal(boundTo('Cfamily'), 99);
});

test('owners see and unbind only the LINE groups feeding their own list', async () => {
  const { DB, owner, pal, outsider, call, group, say, boundTo } = await setup();
  const code = (await call(bindCode.onRequestPost, owner, { body: { list_id: group.id } })).body.code;
  await say('Cfriends', `綁定 ${code}`);
  DB.sqlite.exec("INSERT INTO lists (id, name, is_personal) VALUES (99, '家人', 0); INSERT INTO line_groups (group_id, list_id) VALUES ('Cfamily', 99)");

  const listed = await call(lineGroups.onRequestGet, owner, { method: 'GET', query: `?list=${group.id}` });
  assert.deepEqual(listed.body.map((row) => row.group_id), ['Cfriends']);
  assert.equal((await call(lineGroups.onRequestGet, pal, { method: 'GET', query: `?list=${group.id}` })).status, 404);
  assert.equal((await call(lineGroups.onRequestGet, owner, { method: 'GET' })).status, 403, 'the full list is for site admins');

  assert.equal((await call(lineGroups.onRequestPatch, owner, { method: 'PATCH', body: { group_id: 'Cfamily', list_id: null } })).status, 404);
  assert.equal((await call(lineGroups.onRequestPatch, owner, { method: 'PATCH', body: { group_id: 'Cfriends', list_id: 99 } })).status, 403);
  assert.equal((await call(lineGroups.onRequestPatch, outsider, { method: 'PATCH', body: { group_id: 'Cfriends', list_id: null } })).status, 404);
  assert.equal((await call(lineGroups.onRequestPatch, owner, { method: 'PATCH', body: { group_id: 'Cfriends', list_id: null } })).status, 200);
  assert.equal(boundTo('Cfriends'), null);
});
