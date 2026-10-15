import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { DEFAULT_AI_MODEL, extractPlaces, extractPlacesFromImage } from '../lib/ai.js';
import * as settings from '../functions/api/settings.js';
import * as extract from '../functions/api/extract.js';
import * as extractImage from '../functions/api/extract-image.js';

const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8';

async function setup() {
  const DB = createTestDb();
  const admin = await ensureUser(DB, 'admin@example.test', { ADMIN_EMAILS: 'admin@example.test' });
  const kid = await ensureUser(DB, 'kid@example.test', {});
  const call = async (handler, as, { method = 'GET', body, env = {} } = {}) => {
    const request = new Request('https://example.test/api/settings', { method, body: body && JSON.stringify(body) });
    const response = await handler({ request, env: { DB, ...env }, data: { user: as } });
    return { status: response.status, body: await response.json() };
  };
  return { admin, kid, call };
}

test('only site admins see or change the AI model, and only to a model from the tested list', async () => {
  const { admin, kid, call } = await setup();
  assert.equal((await call(settings.onRequestGet, kid)).status, 403);
  assert.equal((await call(settings.onRequestPut, kid, { method: 'PUT', body: { ai_model: QWEN } })).status, 403);

  const before = (await call(settings.onRequestGet, admin)).body;
  assert.equal(before.ai_model, DEFAULT_AI_MODEL);
  assert.ok(before.models.some((model) => model.id === QWEN));

  assert.equal((await call(settings.onRequestPut, admin, { method: 'PUT', body: { ai_model: '@cf/some/untested-model' } })).status, 400);
  assert.equal((await call(settings.onRequestPut, admin, { method: 'PUT', body: { ai_model: QWEN } })).status, 200);
  assert.equal((await call(settings.onRequestGet, admin)).body.ai_model, QWEN);
});

test('AI extraction runs on the chosen model', async () => {
  const { admin, kid, call } = await setup();
  await call(settings.onRequestPut, admin, { method: 'PUT', body: { ai_model: QWEN } });
  const used = [];
  const AI = { run: async (model) => { used.push(model); return { response: { places: [{ name: '阿宗麵線' }] } }; } };
  const response = await call(extract.onRequestPost, kid, { method: 'POST', body: { caption: '阿宗麵線好吃' }, env: { AI } });
  assert.equal(response.status, 200);
  assert.deepEqual(used, [QWEN]);
});

test('auto: Llama first; only a garbled or failed answer is retried with Qwen, keeping the more complete one', async () => {
  const caption = '#江家餛飩 📍臺中市西區華美街204號 紅油炒手';
  const answers = {
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { name: '江家予駕', address: '臺中市西區華美街204號', dishes: '紅油炒手' },
    [QWEN]: { name: '江家餛飩', address: '臺中市西區華美街204號', dishes: '紅油炒手' },
  };
  const used = [];
  const ai = (overrides = {}) => ({ run: async (model) => {
    used.push(model.includes('qwen') ? 'qwen' : 'llama');
    if (overrides[model] instanceof Error) throw overrides[model];
    return { response: { places: [overrides[model] ?? answers[model]] } };
  } });

  assert.equal((await extractPlaces(ai(), caption)).places[0].name, '江家餛飩');
  assert.deepEqual(used.splice(0), ['llama', 'qwen'], 'garbled name: retried');

  const clean = { '@cf/meta/llama-3.3-70b-instruct-fp8-fast': answers[QWEN] };
  assert.equal((await extractPlaces(ai(clean), caption)).places[0].name, '江家餛飩');
  assert.deepEqual(used.splice(0), ['llama'], 'clean answer: one call only');

  const llamaDown = { '@cf/meta/llama-3.3-70b-instruct-fp8-fast': new Error('busy') };
  assert.equal((await extractPlaces(ai(llamaDown), caption)).places[0].name, '江家餛飩');
  assert.deepEqual(used.splice(0), ['llama', 'qwen'], 'failed answer: retried');
});

test('screenshots: the copied text becomes the caption and the shops are checked against it', async () => {
  const sent = [];
  const ai = { run: async (model, input) => {
    sent.push([model, input.messages[1].content[1].image_url.url.slice(0, 24)]);
    return { choices: [{ message: { content: JSON.stringify({
      text: '江家餛飩\n臺中市西區華美街204號',
      places: [{ name: '江家餛飩', address: '臺中市西區華美街204號', dishes: '', area: '', tags: '' }, { name: '亂寫的店', address: '', dishes: '', area: '', tags: '' }],
    }) } }] };
  } };
  const result = await extractPlacesFromImage(ai, new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');
  assert.equal(result.caption, '江家餛飩\n臺中市西區華美街204號');
  assert.deepEqual(result.places.map((place) => place.name), ['江家餛飩'], 'a name the image never shows is dropped');
  assert.deepEqual(sent, [['@cf/google/gemma-4-26b-a4b-it', 'data:image/jpeg;base64,/']]);
});

test('/api/extract-image takes small images only and counts against the daily AI allowance', async () => {
  const DB = createTestDb();
  const kid = await ensureUser(DB, 'kid@example.test', {});
  const AI = { run: async () => ({ response: { text: '阿宗麵線', places: [{ name: '阿宗麵線', address: '', dishes: '', area: '', tags: '' }] } }) };
  const post = (body, type) => extractImage.onRequestPost({
    request: new Request('https://example.test/api/extract-image', { method: 'POST', body, headers: { 'Content-Type': type } }),
    env: { DB, AI }, data: { user: kid },
  });
  assert.equal((await post('<svg/>', 'image/svg+xml')).status, 415);
  assert.equal((await post(new Uint8Array(0), 'image/jpeg')).status, 400);
  assert.equal((await post(new Uint8Array(2 * 1024 * 1024), 'image/jpeg')).status, 413);
  const ok = await post(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');
  assert.deepEqual([ok.status, (await ok.json()).caption], [200, '阿宗麵線']);
  assert.equal(DB.sqlite.prepare("SELECT count FROM user_daily_usage WHERE api = 'workers_ai'").get().count, 1);
});

test('extractPlaces reads both Llama-style and OpenAI-style answers', async () => {
  const json = JSON.stringify({ places: [{ name: '阿宗麵線', dishes: '', area: '', address: '', tags: '' }] });
  const llama = { run: async () => ({ response: JSON.parse(json) }) };
  const openai = { run: async () => ({ choices: [{ message: { content: json } }] }) };
  assert.equal((await extractPlaces(llama, '阿宗麵線')).places[0].name, '阿宗麵線');
  assert.equal((await extractPlaces(openai, '阿宗麵線', QWEN)).places[0].name, '阿宗麵線');
});
