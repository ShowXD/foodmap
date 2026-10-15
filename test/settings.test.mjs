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

test('extractPlaces reads both Llama-style and OpenAI-style answers', async () => {
  const json = JSON.stringify({ places: [{ name: '阿宗麵線', dishes: '', area: '', address: '', tags: '' }] });
  const llama = { run: async () => ({ response: JSON.parse(json) }) };
  const openai = { run: async () => ({ choices: [{ message: { content: json } }] }) };
  assert.equal((await extractPlaces(llama, '阿宗麵線')).places[0].name, '阿宗麵線');
  assert.equal((await extractPlaces(openai, '阿宗麵線', QWEN)).places[0].name, '阿宗麵線');
});
