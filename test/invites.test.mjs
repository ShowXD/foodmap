import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import * as lists from '../functions/api/lists.js';
import * as invites from '../functions/api/invites.js';
import * as join from '../functions/api/join.js';

async function setup() {
  const DB = createTestDb();
  const owner = await ensureUser(DB, 'owner@example.test', {});
  const member = await ensureUser(DB, 'member@example.test', {});
  const newcomer = await ensureUser(DB, 'newcomer@example.test', {});
  const another = await ensureUser(DB, 'another@example.test', {});
  const call = async (handler, as, { method = 'POST', query = '', body } = {}) => {
    const request = new Request(`https://example.test/api${query}`, { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env: { DB }, data: { user: as } });
    return { status: response.status, body: await response.json() };
  };
  const group = (await call(lists.onRequestPost, owner, { body: { name: '家人' } })).body;
  DB.sqlite.prepare('INSERT INTO list_members (list_id, user_id) VALUES (?, ?)').run(group.id, member.id);
  const isMember = (user) => Boolean(DB.sqlite.prepare('SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?').get(group.id, user.id));
  return { DB, owner, member, newcomer, another, call, group, isMember };
}

test('only the owner (or a site admin) makes invite links; the code is 64 hex characters and stored only as a hash', async () => {
  const { DB, owner, member, newcomer, call, group } = await setup();
  assert.equal((await call(invites.onRequestPost, member, { body: { list_id: group.id } })).status, 404);
  assert.equal((await call(invites.onRequestPost, newcomer, { body: { list_id: group.id } })).status, 404);
  const created = await call(invites.onRequestPost, owner, { body: { list_id: group.id } });
  assert.equal(created.status, 201);
  assert.match(created.body.code, /^[0-9a-f]{64}$/);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM group_invites WHERE code_hash = ?').get(created.body.code).n, 0, 'the plain code is never stored');
  const [personal] = (await call(lists.onRequestGet, owner, { method: 'GET' })).body;
  assert.equal((await call(invites.onRequestPost, owner, { body: { list_id: personal.id } })).status, 404, 'personal lists cannot be shared');
});

test('opening the link joins the group once; it cannot be reused, and members do not use it up', async () => {
  const { owner, member, newcomer, another, call, group, isMember } = await setup();
  const { code } = (await call(invites.onRequestPost, owner, { body: { list_id: group.id } })).body;

  const byMember = await call(join.onRequestPost, member, { body: { code } });
  assert.deepEqual([byMember.status, byMember.body.already_member], [200, true]);

  const joined = await call(join.onRequestPost, newcomer, { body: { code } });
  assert.deepEqual([joined.status, joined.body.list_id, joined.body.list_name, joined.body.already_member], [200, group.id, '家人', false]);
  assert.ok(isMember(newcomer));

  assert.equal((await call(join.onRequestPost, another, { body: { code } })).status, 410);
  assert.ok(!isMember(another));
  assert.equal((await call(join.onRequestPost, another, { body: { code: 'not-a-code' } })).status, 400);
});

test('expired and revoked links stop working; only the owner sees and revokes them', async () => {
  const { DB, owner, member, newcomer, call, group, isMember } = await setup();
  const expiring = (await call(invites.onRequestPost, owner, { body: { list_id: group.id } })).body;
  DB.sqlite.exec(`UPDATE group_invites SET expires_at = datetime('now', '-1 minute') WHERE id = ${expiring.id}`);
  assert.equal((await call(join.onRequestPost, newcomer, { body: { code: expiring.code } })).status, 410);

  const revoked = (await call(invites.onRequestPost, owner, { body: { list_id: group.id } })).body;
  const listed = await call(invites.onRequestGet, owner, { method: 'GET', query: `?list=${group.id}` });
  assert.deepEqual(listed.body.map((row) => row.id), [revoked.id], 'expired links are not listed');
  assert.equal((await call(invites.onRequestGet, member, { method: 'GET', query: `?list=${group.id}` })).status, 404);
  assert.equal((await call(invites.onRequestDelete, member, { method: 'DELETE', body: { id: revoked.id } })).status, 404);
  assert.equal((await call(invites.onRequestDelete, owner, { method: 'DELETE', body: { id: revoked.id } })).status, 200);
  assert.equal((await call(join.onRequestPost, newcomer, { body: { code: revoked.code } })).status, 410);
  assert.ok(!isMember(newcomer));
});
