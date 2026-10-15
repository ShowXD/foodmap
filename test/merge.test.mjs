import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import * as places from '../functions/api/places.js';
import * as merge from '../functions/api/merge-places.js';

test('the same shop posted twice is flagged, and merging keeps the oldest with everything folded in', async () => {
  const DB = createTestDb();
  const mom = await ensureUser(DB, 'mom@example.test', {});
  const kid = await ensureUser(DB, 'kid@example.test', {});
  const stranger = await ensureUser(DB, 'stranger@example.test', {});
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id}), (1, ${kid.id});
    INSERT INTO places (id, list_id, url, google_place_id, name, dishes, caption, note, created_at) VALUES
      (1, 1, 'https://fb.watch/a', 'G1', '江家餛飩', '', 'A 貼文', 'A 備註', '2026-10-01 00:00:00'),
      (2, 1, 'https://fb.watch/b', 'G1', '', '紅油炒手', 'B 貼文', '', '2026-10-05 00:00:00'),
      (3, 1, 'https://fb.watch/c', 'G2', '阿宗麵線', '', '', '', '2026-10-06 00:00:00');
    INSERT INTO place_visits (user_id, place_id, rating, note) VALUES
      (${mom.id}, 1, NULL, '好吃'), (${mom.id}, 2, 5, '湯很讚'), (${kid.id}, 2, 4, NULL);
    INSERT INTO place_stars (user_id, place_id) VALUES (${kid.id}, 2);
    INSERT INTO place_thumbnails (place_id, content_type, image) VALUES (1, NULL, NULL), (2, 'image/png', X'89504E47');`);
  const call = async (handler, as, { method = 'POST', query = '', body } = {}) => {
    const request = new Request(`https://example.test/api${query}`, { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env: { DB }, data: { user: as }, waitUntil: () => {} });
    return { status: response.status, body: await response.json() };
  };

  const listed = (await call(places.onRequestGet, mom, { method: 'GET', query: '?list=1' })).body;
  assert.deepEqual(Object.fromEntries(listed.map((place) => [place.id, place.duplicates])), { 1: [2], 2: [1], 3: [] });

  assert.equal((await call(merge.onRequestPost, stranger, { body: { place_id: 2 } })).status, 404);
  const merged = await call(merge.onRequestPost, mom, { body: { place_id: 2 } });
  assert.deepEqual([merged.status, merged.body], [200, { kept_id: 1, merged: 1 }]);

  const kept = DB.sqlite.prepare('SELECT * FROM places WHERE id = 1').get();
  assert.deepEqual([kept.name, kept.dishes, kept.caption, kept.note], ['江家餛飩', '紅油炒手', 'A 貼文\n---\nB 貼文', 'A 備註\n也出現在：https://fb.watch/b']);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM places WHERE id = 2').get().n, 0);

  const visits = DB.sqlite.prepare('SELECT user_id, rating, note FROM place_visits WHERE place_id = 1 ORDER BY user_id').all().map((row) => ({ ...row }));
  assert.deepEqual(visits, [
    { user_id: mom.id, rating: 5, note: '好吃\n湯很讚' },
    { user_id: kid.id, rating: 4, note: null },
  ]);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM place_stars WHERE place_id = 1 AND user_id = ?').get(kid.id).n, 1);
  assert.equal(DB.sqlite.prepare('SELECT content_type FROM place_thumbnails WHERE place_id = 1').get().content_type, 'image/png');

  assert.equal((await call(merge.onRequestPost, mom, { body: { place_id: 1 } })).status, 409, 'nothing left to merge');
  assert.equal((await call(merge.onRequestPost, mom, { body: { place_id: 3 } })).status, 409);
});
