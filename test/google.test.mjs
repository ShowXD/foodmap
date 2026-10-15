import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { isSameAddress, isSameShop, refreshStaleLocations, searchPlaces } from '../lib/google.js';
import * as reanalyze from '../functions/api/reanalyze.js';
import * as places from '../functions/api/places.js';
import * as placeSearch from '../functions/api/place-search.js';
import * as placeLocation from '../functions/api/place-location.js';
import { onRequestPost as lineWebhook } from '../functions/api/line/webhook.js';

const KEY = 'test-places-key';
const GOOGLE_ID = 'ChIJ_test_place_0001';
const googleHit = (name) => ({ id: GOOGLE_ID, displayName: { text: name }, formattedAddress: '台南市中西區', location: { latitude: 22.99, longitude: 120.2 } });

// Every outgoing request is recorded; Google answers come from `googleReply`, social pages are unreachable.
const sent = [];
let googleReply = () => Response.json({ places: [googleHit('阿宗麵線 台南店')] });
globalThis.fetch = async (url, init = {}) => {
  sent.push({ url: String(url), init });
  return String(url).startsWith('https://places.googleapis.com/') ? googleReply(String(url)) : new Response('', { status: 404 });
};

async function setup() {
  const DB = createTestDb();
  const mom = await ensureUser(DB, 'mom@example.test', {});
  const stranger = await ensureUser(DB, 'stranger@example.test', {});
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id});
    INSERT INTO places (id, list_id, url, name, area) VALUES (10, 1, 'https://fb.watch/a', '阿宗麵線', '台南');`);
  const env = { DB, GOOGLE_PLACES_KEY: KEY };
  const call = async (handler, as, { method = 'POST', query = '', body } = {}) => {
    const request = new Request(`https://example.test/api${query}`, { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env, data: { user: as }, waitUntil: () => {} });
    return { status: response.status, body: await response.json() };
  };
  const row = (id = 10) => ({ ...DB.sqlite.prepare('SELECT * FROM places WHERE id = ?').get(id) });
  return { DB, env, mom, stranger, call, row };
}

test('searchPlaces asks only for the Pro-tier fields and maps the answer', async () => {
  sent.length = 0;
  const [first] = await searchPlaces(KEY, '阿宗麵線 台南');
  assert.deepEqual(first, { google_place_id: GOOGLE_ID, name: '阿宗麵線 台南店', address: '台南市中西區', lat: 22.99, lng: 120.2 });
  assert.equal(sent[0].init.headers['X-Goog-FieldMask'], 'places.id,places.displayName,places.formattedAddress,places.location');
  assert.equal(JSON.parse(sent[0].init.body).pageSize, 3);
});

test('isSameShop: one name contains the other, ignoring spaces and punctuation', () => {
  assert.ok(isSameShop('阿宗麵線', '阿宗麵線 台南店'));
  assert.ok(isSameShop('林東芳牛肉麵（八德店）', '林東芳牛肉麵'));
  assert.ok(!isSameShop('阿宗麵線', '林東芳'));
  assert.ok(!isSameShop('店', '店'));
});

test('place search: list members only, 503 without a key, 429 when Google quota is used up', async () => {
  const { env, mom, stranger, call } = await setup();
  assert.equal((await call(placeSearch.onRequestPost, stranger, { body: { place_id: 10 } })).status, 404);
  const ok = await call(placeSearch.onRequestPost, mom, { body: { place_id: 10 } });
  assert.deepEqual([ok.status, ok.body.query, ok.body.candidates.length], [200, '阿宗麵線 台南', 1]);

  googleReply = () => new Response('{}', { status: 429 });
  assert.equal((await call(placeSearch.onRequestPost, mom, { body: { place_id: 10 } })).status, 429);
  googleReply = () => Response.json({ places: [googleHit('阿宗麵線 台南店')] });
  delete env.GOOGLE_PLACES_KEY;
  assert.equal((await call(placeSearch.onRequestPost, mom, { body: { place_id: 10 } })).status, 503);
});

test('saving a location: Google pick expires, hand-placed is kept; validation and access checks', async () => {
  const { mom, stranger, call, row } = await setup();
  assert.equal((await call(placeLocation.onRequestPut, stranger, { method: 'PUT', body: { place_id: 10, lat: 1, lng: 1 } })).status, 404);
  assert.equal((await call(placeLocation.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, lat: 91, lng: 1 } })).status, 400);
  assert.equal((await call(placeLocation.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, lat: '1', lng: 1 } })).status, 400);
  assert.equal((await call(placeLocation.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, lat: 1, lng: 1, google_place_id: 'x y' } })).status, 400);

  await call(placeLocation.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, lat: 22.99, lng: 120.2, google_place_id: GOOGLE_ID } });
  assert.equal(row().location_source, 'google');
  assert.ok(row().location_fetched_at);

  await call(placeLocation.onRequestPut, mom, { method: 'PUT', body: { place_id: 10, lat: 22.98, lng: 120.21 } });
  assert.deepEqual([row().location_source, row().google_place_id, row().location_fetched_at, row().lat], ['manual', null, null, 22.98]);

  await call(placeLocation.onRequestDelete, mom, { method: 'DELETE', body: { place_id: 10 } });
  assert.deepEqual([row().lat, row().location_source], [null, null]);
});

test('Google coordinates older than 30 days are never served; hand-placed ones stay', async () => {
  const { DB, mom, call } = await setup();
  DB.sqlite.exec(`UPDATE places SET lat = 1, lng = 2, google_place_id = '${GOOGLE_ID}', location_source = 'google', location_fetched_at = datetime('now', '-31 days') WHERE id = 10;
    INSERT INTO places (id, list_id, url, name, lat, lng, location_source) VALUES (11, 1, 'https://fb.watch/b', '自己放的', 3, 4, 'manual');`);
  const rows = (await call(places.onRequestGet, mom, { method: 'GET', query: '?list=1' })).body;
  const byName = Object.fromEntries(rows.map((place) => [place.name, [place.lat, place.google_place_id]]));
  assert.deepEqual(byName, { 阿宗麵線: [null, GOOGLE_ID], 自己放的: [3, null] });
});

test('stale Google coordinates are refreshed by place ID; places Google dropped go back to 待整理', async () => {
  const { DB, row } = await setup();
  DB.sqlite.exec(`UPDATE places SET lat = 1, lng = 2, google_place_id = '${GOOGLE_ID}', location_source = 'google', location_fetched_at = datetime('now', '-26 days') WHERE id = 10;
    INSERT INTO places (id, list_id, url, name, lat, lng, google_place_id, location_source, location_fetched_at)
    VALUES (11, 1, 'https://fb.watch/b', '倒了', 3, 4, 'ChIJ_closed_place_01', 'google', datetime('now', '-26 days'));`);
  googleReply = (url) => (url.includes('closed') ? new Response('{}', { status: 404 }) : Response.json({ location: { latitude: 22.5, longitude: 120.5 } }));
  sent.length = 0;
  await refreshStaleLocations(DB, KEY, 1);
  assert.ok(sent.every((request) => request.init.headers['X-Goog-FieldMask'] === 'location'));
  assert.deepEqual([row().lat, row().lng, row().location_source], [22.5, 120.5, 'google']);
  assert.deepEqual([row(11).lat, row(11).google_place_id], [null, null]);

  sent.length = 0;
  await refreshStaleLocations(DB, KEY, 1);
  assert.equal(sent.length, 0, 'fresh coordinates are not fetched again');
  googleReply = () => Response.json({ places: [googleHit('阿宗麵線 台南店')] });
});

test('isSameAddress compares street and door number, ignoring 臺/台, spaces, full-width digits and the postcode', () => {
  assert.equal(isSameAddress('臺中市西區華美街204號', '403台灣台中市西區華美街204號'), true);
  assert.equal(isSameAddress('華美街２０４號', '403台灣臺中市西區華美街 204 號'), true);
  assert.equal(isSameAddress('台北市大安區忠孝東路四段216巷27弄16號', '106台灣台北市大安區忠孝東路四段216巷27弄16號'), true);
  assert.equal(isSameAddress('臺中市西區華美街204號', '403台灣臺中市西區華美街206號'), false);
  assert.equal(isSameAddress('臺中市西區', '403台灣臺中市西區華美街204號'), false, 'no street number: not enough to trust');
  assert.equal(isSameAddress('', '403台灣臺中市西區華美街204號'), false);
});

test('AI 重新分析: fills a nameless place, locates it by address when names differ, and counts the person\'s AI quota', async () => {
  const { DB, env, mom, stranger, call, row } = await setup();
  DB.sqlite.exec(`INSERT INTO places (id, list_id, url, caption, source, ai_pending) VALUES
    (20, 1, 'https://fb.watch/b', '#江家餛飩 📍臺中市西區華美街204號 還有阿宗麵線', 'line', 1),
    (21, 1, 'https://fb.watch/c', NULL, 'line', 0)`);
  env.AI = { run: async () => ({ response: { places: [{ name: '江家餛飩', address: '臺中市西區華美街204號' }, { name: '阿宗麵線' }] } }) };
  googleReply = () => Response.json({ places: [{ ...googleHit('江家餛飩麵（華美街）'), formattedAddress: '403台灣台中市西區華美街204號' }] });

  assert.equal((await call(reanalyze.onRequestPost, stranger, { body: { place_id: 20 } })).status, 404);
  assert.equal((await call(reanalyze.onRequestPost, mom, { body: { place_id: 21 } })).status, 422, 'no post text saved');
  const analysed = await call(reanalyze.onRequestPost, mom, { body: { place_id: 20 } });
  assert.deepEqual([analysed.status, analysed.body.located], [200, true]);
  assert.deepEqual([row(20).name, row(20).google_place_id, row(20).ai_pending], ['江家餛飩', GOOGLE_ID, 0]);
  const second = DB.sqlite.prepare("SELECT name, source, created_by FROM places WHERE url = 'https://fb.watch/b' AND id <> 20").get();
  assert.deepEqual({ ...second }, { name: '阿宗麵線', source: 'line', created_by: null });
  assert.equal((await call(reanalyze.onRequestPost, mom, { body: { place_id: 20 } })).status, 409, 'already named');

  // Google's top hit is some other shop: the name is filled in, but the app is told it still needs placing.
  DB.sqlite.exec("UPDATE places SET name = '', lat = NULL, lng = NULL, google_place_id = NULL WHERE id = 20");
  googleReply = () => Response.json({ places: [{ ...googleHit('得正 飲料'), formattedAddress: '台中市西區公益路1號' }] });
  const unplaced = await call(reanalyze.onRequestPost, mom, { body: { place_id: 20 } });
  assert.deepEqual([unplaced.status, unplaced.body.located, row(20).name, row(20).lat], [200, false, '江家餛飩', null]);

  DB.sqlite.prepare("UPDATE user_daily_usage SET count = 30 WHERE user_id = ? AND api = 'workers_ai'").run(mom.id);
  DB.sqlite.exec("UPDATE places SET name = '' WHERE id = 20");
  assert.equal((await call(reanalyze.onRequestPost, mom, { body: { place_id: 20 } })).status, 429);
  googleReply = () => Response.json({ places: [googleHit('阿宗麵線 台南店')] });
});

test('疑似亂碼: the list flags it, AI re-analysis replaces the garbled fields, hand edits are left alone', async () => {
  const { DB, env, mom, call, row } = await setup();
  DB.sqlite.exec(`INSERT INTO places (id, list_id, url, caption, name, address, dishes, source) VALUES
    (30, 1, 'https://fb.watch/g', '#江家餛飩 📍臺中市西區華美街204號 紅油炒手', '江家予駕', '號中市西園區華美街204號', '紅油炒手', 'line')`);
  env.AI = { run: async () => ({ response: { places: [{ name: '江家餛飩', address: '臺中市西區華美街204號', dishes: '炒手' }] } }) };
  googleReply = () => Response.json({ places: [{ ...googleHit('江家餛飩'), formattedAddress: '403台灣台中市西區華美街204號' }] });

  const listed = (await call(places.onRequestGet, mom, { method: 'GET', query: '?list=1' })).body.find((place) => place.id === 30);
  assert.deepEqual(listed.garbled, ['name', 'address']);

  const fixed = await call(reanalyze.onRequestPost, mom, { body: { place_id: 30 } });
  assert.deepEqual([fixed.status, fixed.body.located], [200, true]);
  assert.deepEqual([row(30).name, row(30).address, row(30).dishes], ['江家餛飩', '臺中市西區華美街204號', '紅油炒手'], 'only garbled fields are replaced');
  assert.equal((await call(reanalyze.onRequestPost, mom, { body: { place_id: 30 } })).status, 409, 'nothing left to fix');

  // Once a person edits the name, it is never flagged or replaced.
  DB.sqlite.exec("UPDATE places SET name = '江家予駕' WHERE id = 30");
  await call(places.onRequestPatch, mom, { method: 'PATCH', body: { id: 30, name: '江家（我自己取的名字）' } });
  assert.equal(row(30).hand_edited, 1);
  assert.equal((await call(reanalyze.onRequestPost, mom, { body: { place_id: 30 } })).status, 409);
  googleReply = () => Response.json({ places: [googleHit('阿宗麵線 台南店')] });
});

test('LINE: a shop is located automatically only when Google\'s top hit has the same name', async () => {
  const { DB, env } = await setup();
  DB.sqlite.exec("INSERT INTO line_groups (group_id, list_id) VALUES ('Cgroup', 1)");
  env.LINE_CHANNEL_SECRET = 'secret';
  env.AI = { run: async () => ({ response: { places: [{ name: '阿宗麵線', area: '台南' }, { name: '神秘小店' }] } }) };
  const body = JSON.stringify({ events: [{ type: 'message', message: { id: 'm1', type: 'text', text: '台南阿宗麵線、神秘小店都好吃 https://www.instagram.com/reel/x/' }, source: { type: 'group', groupId: 'Cgroup' } }] });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64');
  const pending = [];
  const request = new Request('https://example.test/api/line/webhook', { method: 'POST', body, headers: { 'x-line-signature': signature } });
  await lineWebhook({ request, env, waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  const located = DB.sqlite.prepare("SELECT name, google_place_id FROM places WHERE source = 'line' ORDER BY id").all().map((r) => [r.name, r.google_place_id]);
  assert.deepEqual(located, [['阿宗麵線', GOOGLE_ID], ['神秘小店', null]]);
});
