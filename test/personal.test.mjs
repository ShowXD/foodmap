import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import * as places from '../functions/api/places.js';
import * as visits from '../functions/api/visits.js';
import * as stars from '../functions/api/stars.js';
import * as listRead from '../functions/api/list-read.js';
import * as exporter from '../functions/api/export.js';

async function setup() {
  const DB = createTestDb();
  const mom = await ensureUser(DB, 'mom@example.test', {});
  const kid = await ensureUser(DB, 'kid@example.test', {});
  const stranger = await ensureUser(DB, 'stranger@example.test', {});
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id}), (1, ${kid.id});
    INSERT INTO places (id, list_id, url, name, created_by, created_at) VALUES (10, 1, 'https://www.instagram.com/reel/a/', '阿宗麵線', ${mom.id}, '2026-10-01 00:00:00');`);
  const call = async (handler, as, { method = 'GET', query = '', body } = {}) => {
    const request = new Request(`https://example.test/api${query}`, { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env: { DB }, data: { user: as } });
    return { status: response.status, response };
  };
  const listFor = async (as) => (await (await call(places.onRequestGet, as, { query: '?list=1' })).response.json())[0];
  return { DB, mom, kid, stranger, call, listFor };
}

test('each person marks 吃過 with their own rating; the family sees the count and average', async () => {
  const { mom, kid, stranger, call, listFor } = await setup();
  assert.equal((await call(visits.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, rating: 5, note: '湯頭讚' } })).status, 200);
  assert.equal((await call(visits.onRequestPut, kid, { method: 'PUT', body: { place_id: 10, rating: 4 } })).status, 200);
  assert.equal((await call(visits.onRequestPut, kid, { method: 'PUT', body: { place_id: 10, rating: 9 } })).status, 400);
  assert.equal((await call(visits.onRequestPut, stranger, { method: 'PUT', body: { place_id: 10 } })).status, 404);

  const seenByMom = await listFor(mom);
  assert.deepEqual([seenByMom.my_rating, seenByMom.my_note, seenByMom.visit_count, seenByMom.avg_rating], [5, '湯頭讚', 2, 4.5]);
  const all = await (await call(visits.onRequestGet, kid, { query: '?place=10' })).response.json();
  assert.deepEqual(all.map((v) => [v.email, v.rating, v.is_mine]).sort(), [['kid@example.test', 4, 1], ['mom@example.test', 5, 0]]);
  assert.equal((await call(visits.onRequestGet, stranger, { query: '?place=10' })).status, 404);

  assert.equal((await call(visits.onRequestDelete, kid, { method: 'DELETE', body: { place_id: 10 } })).status, 200);
  const afterUndo = await listFor(kid);
  assert.deepEqual([afterUndo.my_visited_at, afterUndo.visit_count], [null, 1]);
});

test('stars are personal', async () => {
  const { mom, kid, stranger, call, listFor } = await setup();
  assert.equal((await call(stars.onRequestPut, kid, { method: 'PUT', body: { place_id: 10 } })).status, 200);
  assert.equal((await call(stars.onRequestPut, kid, { method: 'PUT', body: { place_id: 10 } })).status, 200);
  assert.equal((await call(stars.onRequestPut, stranger, { method: 'PUT', body: { place_id: 10 } })).status, 404);
  assert.equal((await listFor(kid)).starred, 1);
  assert.equal((await listFor(mom)).starred, 0);
  await call(stars.onRequestDelete, kid, { method: 'DELETE', body: { place_id: 10 } });
  assert.equal((await listFor(kid)).starred, 0);
});

test('"新" marks places others added after I last opened the list', async () => {
  const { DB, mom, kid, call, listFor } = await setup();
  // First visit: nothing is new yet.
  assert.equal((await listFor(kid)).is_new, 0);
  assert.equal((await call(listRead.onRequestPost, kid, { method: 'POST', body: { list_id: 1 } })).status, 200);
  DB.sqlite.exec(`INSERT INTO places (id, list_id, url, name, created_by, created_at) VALUES
    (11, 1, 'https://fb.watch/b', '林東芳', ${mom.id}, '2999-01-01 00:00:00'),
    (12, 1, 'https://fb.watch/c', '自己加的', ${kid.id}, '2999-01-01 00:00:00');`);
  const rows = await (await call(places.onRequestGet, kid, { query: '?list=1' })).response.json();
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.name, row.is_new])), { 林東芳: 1, 自己加的: 0, 阿宗麵線: 0 });
});

test('CSV export: list members only, Excel-friendly BOM, formulas neutralised', async () => {
  const { DB, mom, stranger, call } = await setup();
  DB.sqlite.exec(`INSERT INTO places (list_id, url, name, note) VALUES (1, 'https://fb.watch/d', '"引號"店', '=HYPERLINK("x")')`);
  await call(visits.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, rating: 5 } });
  assert.equal((await call(exporter.onRequestGet, stranger, { query: '?list=1' })).status, 404);

  const { response } = await call(exporter.onRequestGet, mom, { query: '?list=1' });
  assert.match(response.headers.get('Content-Type'), /text\/csv/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  // TextDecoder drops the BOM, so the text starts at the header row.
  const csv = new TextDecoder().decode(bytes);
  assert.ok(csv.startsWith('"店名"'));
  assert.match(csv, /"阿宗麵線".*"5"/);
  assert.match(csv, /"""引號""店"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.equal(exporter.toCsvCell(null), '""');
});

test('deleting a place (LINE unsend) also removes its visits and stars', async () => {
  const { DB, kid, call } = await setup();
  await call(visits.onRequestPut, kid, { method: 'PUT', body: { place_id: 10 } });
  await call(stars.onRequestPut, kid, { method: 'PUT', body: { place_id: 10 } });
  DB.sqlite.exec('DELETE FROM places WHERE id = 10');
  const left = DB.sqlite.prepare('SELECT (SELECT COUNT(*) FROM place_visits) + (SELECT COUNT(*) FROM place_stars) AS n').get();
  assert.equal(left.n, 0);
});
