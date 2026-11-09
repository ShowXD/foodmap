import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost, DAILY_EXTRACT_LIMIT } from '../functions/api/extract.js';
import { extractPlaces, garbledFields, isPosterName, parsePlaces, posterNames, groundPlaces } from '../lib/ai.js';
import { fetchSocialPage, isSocialUrl, parseOgText } from '../lib/social.js';
import { ensureUser } from '../lib/users.js';
import { createTestDb } from './d1.mjs';

const post = (body) => new Request('http://localhost/api/extract', { method: 'POST', body: JSON.stringify(body) });

test('isSocialUrl only allows IG/FB/Threads/YouTube hosts', () => {
  assert.ok(isSocialUrl('https://youtube.com/shorts/AbCdEfGhIjk'));
  assert.ok(isSocialUrl('https://m.youtube.com/shorts/AbCdEfGhIjk?feature=share'));
  assert.ok(isSocialUrl('https://youtu.be/AbCdEfGhIjk'));
  assert.ok(!isSocialUrl('https://notyoutube.com/shorts/x'));
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

test('fetchSocialPage follows redirects between social hosts but never requests any other host', async () => {
  const realFetch = globalThis.fetch;
  const requested = [];
  const redirects = {
    'https://fb.watch/abc': 'https://www.facebook.com/reel/1',
    'https://www.facebook.com/share/r/x': 'https://l.facebook.com/l.php?u=evil',
    'https://l.facebook.com/l.php?u=evil': 'https://evil.example/steal',
  };
  globalThis.fetch = async (url, init) => {
    requested.push(url);
    assert.equal(init.redirect, 'manual');
    if (redirects[url]) return new Response(null, { status: 302, headers: { Location: redirects[url] } });
    return new Response('<meta property="og:title" content="阿宗麵線">');
  };
  try {
    assert.match(await fetchSocialPage('https://fb.watch/abc'), /阿宗麵線/);
    assert.equal(await fetchSocialPage('https://www.facebook.com/share/r/x'), '');
    assert.ok(!requested.some((url) => url.startsWith('https://evil.example')), requested.join(' '));
  } finally {
    globalThis.fetch = realFetch;
  }
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

test('groundPlaces drops names, places and dishes the post never says, but keeps the AI\'s own tags', () => {
  const post = '#江家餛飩 📍臺中市西區華美街204號 📌紅油鮮蝦炒手麵 餛飩湯 #台中美食';
  const garbled = { name: '江家予龍', dishes: '紅油蝦蘋十鸡龍', area: '號中市西園区', address: '號中市西園路區三萬號運204畫号', tags: '庫美美飯 #台中美食' };
  const good = { name: '江家餛飩', dishes: '紅油鮮蝦炒手麵, 餛飩湯', area: '台中市 西區', address: '台中市西區華美街204號', tags: '台中美食 平價' };
  assert.deepEqual(groundPlaces([garbled, good], post), [
    { name: '江家餛飩', dishes: '紅油鮮蝦炒手麵、餛飩湯', area: '台中市 西區', address: '台中市西區華美街204號', tags: '台中美食 平價' },
  ]);
  // Place names (the 地區 field has them) and anything past three tags are dropped.
  const [tagged] = groundPlaces([{ ...good, tags: '["臺中", "西區"] 宵夜 平價 #排隊 甜點' }], post);
  assert.equal(tagged.tags, '宵夜 平價 排隊');
});

test('garbledFields flags name/address/area with characters the post never uses, unless edited by hand', () => {
  const caption = '#江家餛飩 📍臺中市西區華美街204號';
  const garbled = { caption, name: '江家予駕', address: '號中市西園區華美街204號', area: '台中 西區', dishes: '亂寫的菜' };
  assert.deepEqual(garbledFields(garbled), ['name', 'address']);
  assert.deepEqual(garbledFields({ ...garbled, name: '江家餛飩', address: '台中市西區華美街204號' }), []);
  assert.deepEqual(garbledFields({ ...garbled, hand_edited: 1 }), [], 'a person\'s own wording is trusted');
  assert.deepEqual(garbledFields({ ...garbled, caption: '' }), [], 'nothing to compare against');
});

test('the poster is never taken for a shop, unless the account is the shop itself', async () => {
  const threads = 'Threads 上的多莉 Dolly ｜ 台中美食 景點 探店（@dollybb_777）\n吃幾次愛幾次 試營運時間';
  assert.deepEqual(posterNames(threads), ['多莉 Dolly', 'dollybb_777']);
  const facebook = '120 萬次觀看 · 4,885 個心情 | 台中排隊芒果雪花冰 | 水星人的怪咖時代\n台中排隊芒果雪花冰';
  assert.deepEqual(posterNames(facebook), ['水星人的怪咖時代']);
  // Only two parts: the last one is the post, which names the shop.
  assert.deepEqual(posterNames('19 萬次觀看 · 486 個心情 | 牛範生台式蒜香牛排'), []);
  // A shop's own account is kept.
  assert.deepEqual(posterNames('Threads 上的光之谷 l 台灣果萃茶飲（@guangzhigu2023）'), ['guangzhigu2023']);
  assert.ok(isPosterName('多莉Dolly', posterNames(threads)));
  assert.ok(!isPosterName('台中世外桃源', posterNames(threads)));

  const ai = { run: async () => ({ response: { places: [{ name: '水星人的怪咖時代', dishes: '芒果雪花冰', area: '台中' }, { name: '台中世外桃源' }] } }) };
  const { places } = await extractPlaces(ai, `${facebook}\n台中世外桃源也很好吃`, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.deepEqual(places.map((place) => [place.name, place.dishes]), [['', '芒果雪花冰'], ['台中世外桃源', '']]);
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
  const ok = await extract({ caption: '一次吃兩家：阿宗麵線、林東芳牛肉麵' }, { run: async () => ({ response: twoShops }) });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).places.map((place) => place.name), ['阿宗麵線', '林東芳牛肉麵']);

  const none = await extract({ caption: '今天天氣好' }, { run: async () => ({ response: { places: [] } }) });
  assert.equal(none.status, 422);

  const failed = await extract({ caption: '阿宗麵線' }, { run: async () => { throw new Error('daily limit'); } });
  assert.equal(failed.status, 502);
});

test('when the post text names no shop, the cover image is read and its text joins the caption', async () => {
  const extract = await asUser('mom@example.test');
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).startsWith('https://cdn.example/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    return new Response('<meta property="og:description" content="台中新開的西式鐵板燒"><meta property="og:image" content="https://cdn.example/cover.jpg">');
  };
  const models = [];
  const AI = {
    run: async (model, { messages }) => {
      models.push(model);
      if (Array.isArray(messages[1].content)) return { response: { text: '心焰鐵板燒 文心路四段938號', places: [{ name: '心焰鐵板燒', address: '文心路四段938號' }] } };
      return { response: { places: messages[1].content.includes('心焰') ? [{ name: '心焰鐵板燒' }] : [] } };
    },
  };
  try {
    const fromCover = await extract({ url: 'https://www.threads.com/@a/post/x' }, AI);
    assert.equal(fromCover.status, 200);
    const body = await fromCover.json();
    assert.equal(body.caption, '台中新開的西式鐵板燒\n封面圖文字：心焰鐵板燒 文心路四段938號');
    assert.deepEqual(body.places.map((place) => place.name), ['心焰鐵板燒']);
    assert.equal(models.length, 2, 'text first, then the image');

    // The text already names the shop: the cover is never downloaded.
    fetched.length = 0;
    assert.equal((await extract({ url: 'https://www.threads.com/@a/post/x', caption: '心焰鐵板燒' }, AI)).status, 200);
    assert.ok(!fetched.some((url) => url.startsWith('https://cdn.example/')));
  } finally {
    globalThis.fetch = realFetch;
  }
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
