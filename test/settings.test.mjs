import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { DEFAULT_AI_MODEL, extractPlaces } from '../lib/ai.js';
import * as settings from '../functions/api/settings.js';
import * as extract from '../functions/api/extract.js';

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

test('extractPlaces reads both Llama-style and OpenAI-style answers', async () => {
  const json = JSON.stringify({ places: [{ name: '阿宗麵線', dishes: '', area: '', address: '', tags: '' }] });
  const llama = { run: async () => ({ response: JSON.parse(json) }) };
  const openai = { run: async () => ({ choices: [{ message: { content: json } }] }) };
  assert.equal((await extractPlaces(llama, '阿宗麵線')).places[0].name, '阿宗麵線');
  assert.equal((await extractPlaces(openai, '阿宗麵線', QWEN)).places[0].name, '阿宗麵線');
});
