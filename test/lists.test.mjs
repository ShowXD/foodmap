import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import * as places from '../functions/api/places.js';
import * as lists from '../functions/api/lists.js';
import * as members from '../functions/api/list-members.js';
import * as users from '../functions/api/users.js';

const ENV = { ADMIN_EMAILS: 'admin@example.test' };

async function setup() {
  const DB = createTestDb();
  const user = async (email) => ensureUser(DB, email, ENV);
  const call = async (handler, as, { method = 'GET', query = '', body } = {}) => {
    const request = new Request(`https://example.test/api${query}`, { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env: { DB }, data: { user: as } });
    return { status: response.status, body: await response.json() };
  };
  return { DB, user, call };
}

const myLists = async (call, as) => (await call(lists.onRequestGet, as)).body;
// What opening an invite link does (see invites.test.mjs); used here to set up members.
const join = (DB, listId, person) => DB.sqlite.prepare('INSERT INTO list_members (list_id, user_id) VALUES (?, ?)').run(listId, person.id);

test('new users are approved and get a private personal list', async () => {
  const { user, call } = await setup();
  const stranger = await user('stranger@example.test');
  assert.equal(stranger.status, 'approved');
  const [personal, ...others] = await myLists(call, stranger);
  assert.deepEqual([personal.name, personal.is_personal, personal.is_owner, others.length], ['我的清單', 1, 1, 0]);
  // Calling again must not create a second personal list.
  assert.equal((await myLists(call, stranger)).length, 1);
});

test('personal lists stay private, even from site admins', async () => {
  const { user, call } = await setup();
  const mom = await user('mom@example.test');
  const admin = await user('admin@example.test');
  const [momList] = await myLists(call, mom);
  await call(places.onRequestPost, mom, { method: 'POST', body: { list_id: momList.id, url: 'https://www.instagram.com/reel/a/', name: '秘密小館' } });

  assert.equal((await call(places.onRequestGet, admin, { query: `?list=${momList.id}` })).status, 404);
  const intruder = await user('intruder@example.test');
  assert.equal((await call(places.onRequestGet, intruder, { query: `?list=${momList.id}` })).status, 404);
  assert.equal((await call(places.onRequestPost, intruder, { method: 'POST', body: { list_id: momList.id, url: 'https://x.test/', name: 'x' } })).status, 404);

  const mine = await call(places.onRequestGet, mom, { query: `?list=${momList.id}` });
  assert.deepEqual(mine.body.map((place) => [place.name, place.created_by]), [['秘密小館', mom.id]]);
});

test('anyone can start a group and owns it; only site admins create one for someone else', async () => {
  const { user, call } = await setup();
  const friend = await user('friend@example.test');
  await user('mom@example.test');

  const created = await call(lists.onRequestPost, friend, { method: 'POST', body: { name: '朋友團', owner_email: 'mom@example.test' } });
  assert.equal(created.status, 201);
  const [, group] = await myLists(call, friend);
  assert.deepEqual([group.name, group.is_owner, group.is_member], ['朋友團', 1, 1], 'owner_email is ignored for non-admins');

  for (let index = 2; index <= 10; index++) await call(lists.onRequestPost, friend, { method: 'POST', body: { name: `團 ${index}` } });
  assert.equal((await call(lists.onRequestPost, friend, { method: 'POST', body: { name: '第 11 團' } })).status, 429);
});

test('any member may leave a group, but an owner cannot just walk away', async () => {
  const { DB, user, call } = await setup();
  const friend = await user('friend@example.test');
  const pal = await user('pal@example.test');
  const group = (await call(lists.onRequestPost, friend, { method: 'POST', body: { name: '朋友團' } })).body;
  join(DB, group.id, pal);

  assert.equal((await call(members.onRequestDelete, friend, { method: 'DELETE', body: { list_id: group.id, user_id: friend.id } })).status, 403);
  assert.equal((await call(members.onRequestDelete, pal, { method: 'DELETE', body: { list_id: group.id, user_id: pal.id } })).status, 200);
  assert.deepEqual((await myLists(call, pal)).map((list) => list.name), ['我的清單']);
  const [personal] = await myLists(call, pal);
  assert.equal((await call(members.onRequestDelete, pal, { method: 'DELETE', body: { list_id: personal.id, user_id: pal.id } })).status, 404, 'personal lists have no members to leave');
});

test('site admins can create groups for someone else; members see the group, outsiders do not', async () => {
  const { user, call } = await setup();
  const admin = await user('admin@example.test');
  const mom = await user('mom@example.test');
  const kid = await user('kid@example.test');
  const stranger = await user('stranger@example.test');

  assert.equal((await call(lists.onRequestPost, admin, { method: 'POST', body: { name: '家人', owner_email: 'nobody@example.test' } })).status, 404);
  const family = (await call(lists.onRequestPost, admin, { method: 'POST', body: { name: '家人', owner_email: 'MOM@example.test' } })).body;

  // Owners invite with a link; adding by email is for site admins only, so nobody else can pull people
  // in or probe which emails are registered.
  assert.equal((await call(members.onRequestPost, stranger, { method: 'POST', body: { list_id: family.id, email: 'stranger@example.test' } })).status, 403);
  assert.equal((await call(members.onRequestPost, mom, { method: 'POST', body: { list_id: family.id, email: 'kid@example.test' } })).status, 403);
  assert.equal((await call(members.onRequestPost, mom, { method: 'POST', body: { list_id: family.id, email: 'ghost@example.test' } })).status, 403);
  assert.equal((await call(members.onRequestPost, admin, { method: 'POST', body: { list_id: family.id, email: 'kid@example.test' } })).status, 201);
  assert.equal((await call(members.onRequestPost, admin, { method: 'POST', body: { list_id: family.id, email: 'kid@example.test' } })).status, 409);
  assert.equal((await call(members.onRequestPost, admin, { method: 'POST', body: { list_id: family.id, email: 'ghost@example.test' } })).status, 404);

  const saved = await call(places.onRequestPost, kid, { method: 'POST', body: { list_id: family.id, url: 'https://www.instagram.com/reel/b/', name: '阿宗麵線' } });
  assert.equal(saved.status, 201);
  assert.deepEqual((await call(places.onRequestGet, mom, { query: `?list=${family.id}` })).body.map((p) => p.name), ['阿宗麵線']);
  assert.equal((await call(places.onRequestGet, stranger, { query: `?list=${family.id}` })).status, 404);
  assert.equal((await call(places.onRequestPatch, stranger, { method: 'PATCH', body: { id: saved.body.id, name: '改掉' } })).status, 404);

  assert.deepEqual((await myLists(call, kid)).map((list) => list.name), ['我的清單', '家人']);
  assert.deepEqual((await myLists(call, stranger)).map((list) => list.name), ['我的清單']);
  // Site admin can reach every group without being a member.
  assert.deepEqual((await myLists(call, admin)).map((list) => [list.name, list.is_member]), [['我的清單', 1], ['家人', 0]]);
});

test('members cannot manage the group; owners cannot be removed except by a site admin', async () => {
  const { DB, user, call } = await setup();
  const admin = await user('admin@example.test');
  const mom = await user('mom@example.test');
  const kid = await user('kid@example.test');
  await user('aunt@example.test');
  const family = (await call(lists.onRequestPost, admin, { method: 'POST', body: { name: '家人', owner_email: 'mom@example.test' } })).body;
  join(DB, family.id, kid);

  assert.equal((await call(members.onRequestPost, kid, { method: 'POST', body: { list_id: family.id, email: 'aunt@example.test' } })).status, 403);
  assert.equal((await call(members.onRequestDelete, kid, { method: 'DELETE', body: { list_id: family.id, user_id: mom.id } })).status, 404);
  assert.equal((await call(members.onRequestDelete, mom, { method: 'DELETE', body: { list_id: family.id, user_id: mom.id } })).status, 403);

  const view = await call(members.onRequestGet, kid, { query: `?list=${family.id}` });
  assert.deepEqual([view.body.canManage, view.body.members.map((m) => m.email)], [false, ['mom@example.test', 'kid@example.test']]);

  assert.equal((await call(members.onRequestDelete, mom, { method: 'DELETE', body: { list_id: family.id, user_id: kid.id } })).status, 200);
  assert.equal((await call(places.onRequestGet, kid, { query: `?list=${family.id}` })).status, 404);
  assert.equal((await call(members.onRequestDelete, admin, { method: 'DELETE', body: { list_id: family.id, user_id: mom.id } })).status, 200);
});

test('site admins see every account with its groups and can add anyone to any group', async () => {
  const { user, call } = await setup();
  const admin = await user('admin@example.test');
  const friend = await user('friend@example.test');
  const group = (await call(lists.onRequestPost, friend, { method: 'POST', body: { name: '朋友團' } })).body;
  await user('newbie@example.test');

  assert.equal((await call(users.onRequestGet, friend)).status, 403);
  assert.equal((await call(members.onRequestPost, admin, { method: 'POST', body: { list_id: group.id, email: 'newbie@example.test' } })).status, 201);
  const accounts = (await call(users.onRequestGet, admin)).body;
  assert.deepEqual(accounts.map((account) => [account.email, account.group_names]), [
    ['admin@example.test', null],
    ['friend@example.test', '朋友團'],
    ['newbie@example.test', '朋友團'],
  ]);
});

test('only site admins can make someone a group owner', async () => {
  const { user, call } = await setup();
  const admin = await user('admin@example.test');
  const mom = await user('mom@example.test');
  await user('kid@example.test');
  await user('aunt@example.test');
  const family = (await call(lists.onRequestPost, admin, { method: 'POST', body: { name: '家人', owner_email: 'mom@example.test' } })).body;

  // An owner can't add by email at all (let alone as owner); a site admin can choose either.
  assert.equal((await call(members.onRequestPost, mom, { method: 'POST', body: { list_id: family.id, email: 'kid@example.test', is_owner: true } })).status, 403);
  assert.equal((await call(members.onRequestPost, admin, { method: 'POST', body: { list_id: family.id, email: 'kid@example.test' } })).body.is_owner, 0);
  assert.equal((await call(members.onRequestPost, admin, { method: 'POST', body: { list_id: family.id, email: 'aunt@example.test', is_owner: true } })).body.is_owner, 1);
});

test('the same shop can be saved once per list', async () => {
  const { user, call } = await setup();
  const mom = await user('mom@example.test');
  const [momList] = await myLists(call, mom);
  const body = { list_id: momList.id, url: 'https://www.instagram.com/reel/c/', name: '林東芳' };
  assert.equal((await call(places.onRequestPost, mom, { method: 'POST', body })).status, 201);
  assert.equal((await call(places.onRequestPost, mom, { method: 'POST', body })).status, 409);
  assert.equal((await call(places.onRequestPost, mom, { method: 'POST', body: { ...body, name: '阿宗麵線' } })).status, 201);
});
