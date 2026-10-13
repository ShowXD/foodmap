import assert from 'node:assert/strict';
import test from 'node:test';
import { isSocialUrl, parseOgText, parsePlaces, onRequestPost, DAILY_EXTRACT_LIMIT } from '../functions/api/extract.js';
import { ensureUser } from '../lib/users.js';
import { createTestDb } from './d1.mjs';

const post = (body) => new Request('http://localhost/api/extract', { method: 'POST', body: JSON.stringify(body) });

test('isSocialUrl only allows IG/FB/Threads hosts', () => {
  assert.ok(isSocialUrl('https://www.instagram.com/reel/abc/'));
  assert.ok(isSocialUrl('https://m.facebook.com/watch?v=1'));
  assert.ok(isSocialUrl('https://fb.watch/xyz'));
  assert.ok(isSocialUrl('https://www.threads.net/@foodie/post/abc'));
  assert.ok(isSocialUrl('https://www.threads.com/@foodie/post/abc'));
  assert.ok(!isSocialUrl('https://evilthreads.net/'));
  assert.ok(!isSocialUrl('https://evilinstagram.com/'));
  assert.ok(!isSocialUrl('http://169.254.169.254/latest'));
  assert.ok(!isSocialUrl('javascript:alert(1)'));
});

test('parseOgText reads both attribute orders and decodes entities', () => {
  const html = `<meta property="og:title" content="阿宗麵線 &amp; 大腸">
    <meta content="台北西門町 &#x1F35C; 必吃&quot;麵線&quot;" name="og:description">`;
  assert.equal(parseOgText(html), '阿宗麵線 & 大腸\n台北西門町 🍜 必吃"麵線"');
  assert.equal(parseOgText('<html></html>'), '');
});

test('parsePlaces handles several shops, JSON strings, and a bare single object', () => {
  const shopA = { name: '阿宗麵線', dishes: '', area: '台北 萬華', address: '', tags: '' };
  const shopB = { name: '林東芳牛肉麵', dishes: '牛肉麵', area: '', address: '', tags: '' };
  assert.deepEqual(parsePlaces({ places: [{ name: ' 阿宗麵線 ', area: '台北 萬華' }, { name: '林東芳牛肉麵', dishes: '牛肉麵' }] }), [shopA, shopB]);
  assert.deepEqual(parsePlaces('{"places":[{"name":"阿宗麵線","area":"台北 萬華"}]}'), [shopA]);
  assert.deepEqual(parsePlaces({ name: '阿宗麵線', area: '台北 萬華' }), [shopA]);
  assert.deepEqual(parsePlaces({ places: [{ name: '', dishes: '', area: '台北' }, null] }), []);
  assert.equal(parsePlaces({ places: Array.from({ length: 15 }, (_, i) => ({ name: `店${i}` })) }).length, 10);
  assert.equal(parsePlaces('not json'), null);
  assert.equal(parsePlaces(undefined), null);
});

test('extract returns 503 when the AI binding is missing', async () => {
  const response = await onRequestPost({ request: post({ caption: 'x' }), env: {} });
  assert.equal(response.status, 503);
});

test('extract asks for caption when it cannot fetch one', async () => {
  const response = await onRequestPost({ request: post({ url: 'https://example.com/' }), env: { AI: {} } });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).needCaption, true);
});

async function asUser(email) {
  const DB = createTestDb();
  const user = await ensureUser(DB, email, {});
  return (body, AI) => onRequestPost({ request: post(body), env: { DB, AI }, data: { user } });
}

test('extract returns every shop the AI found, 422 when none, and 502 when AI fails', async () => {
  const extract = await asUser('mom@example.test');
  const twoShops = { places: [{ name: '阿宗麵線', dishes: '麵線' }, { name: '林東芳牛肉麵', dishes: '牛肉麵' }] };
  const ok = await extract({ caption: '一次吃兩家' }, { run: async () => ({ response: twoShops }) });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).places.map((place) => place.name), ['阿宗麵線', '林東芳牛肉麵']);

  const none = await extract({ caption: '今天天氣好' }, { run: async () => ({ response: { places: [] } }) });
  assert.equal(none.status, 422);

  const failed = await extract({ caption: '阿宗麵線' }, { run: async () => { throw new Error('daily limit'); } });
  assert.equal(failed.status, 502);
});

test('each user gets a daily AI extraction limit; the AI is not called once it is used up', async () => {
  const extract = await asUser('mom@example.test');
  let aiCalls = 0;
  const AI = { run: async () => { aiCalls++; return { response: { places: [{ name: '店' }] } }; } };
  for (let i = 0; i < DAILY_EXTRACT_LIMIT; i++) assert.equal((await extract({ caption: '店' }, AI)).status, 200);
  assert.equal((await extract({ caption: '店' }, AI)).status, 429);
  assert.equal(aiCalls, DAILY_EXTRACT_LIMIT);

  // Another family member has their own quota.
  const otherExtract = await asUser('kid@example.test');
  assert.equal((await otherExtract({ caption: '店' }, AI)).status, 200);
});
