import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { onRequestPut } from '../functions/api/tags.js';

test('tags: rename, merge and remove across one list, members only', async () => {
  const DB = createTestDb();
  const mom = await ensureUser(DB, 'mom@example.test', {});
  const stranger = await ensureUser(DB, 'stranger@example.test', {});
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0), (2, '別的', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id});
    INSERT INTO places (id, list_id, url, tags) VALUES
      (1, 1, 'https://a', '##台中美食 宵夜'),
      (2, 1, 'https://b', '台中 台中美食'),
      (3, 1, 'https://c', '台中美食甜點'),
      (4, 2, 'https://d', '台中美食');`);
  const put = async (as, body) => {
    const response = await onRequestPut({ request: new Request('https://x/api/tags', { method: 'PUT', body: JSON.stringify(body) }), env: { DB }, data: { user: as } });
    return { status: response.status, body: await response.json() };
  };
  const tags = () => Object.fromEntries(DB.sqlite.prepare('SELECT id, tags FROM places ORDER BY id').all().map((row) => [row.id, row.tags]));

  assert.equal((await put(stranger, { list_id: 1, from: '台中美食', to: '台中' })).status, 404);
  assert.equal((await put(mom, { list_id: 1, from: '台中美食', to: '台中 小吃' })).status, 400);

  // Merged into 台中: no 台中 twice; a longer tag that only contains the word is left alone; the other list too.
  assert.deepEqual((await put(mom, { list_id: 1, from: '台中美食', to: '台中' })).body, { updated: 2 });
  assert.deepEqual(tags(), { 1: '台中 宵夜', 2: '台中', 3: '台中美食甜點', 4: '台中美食' });

  assert.deepEqual((await put(mom, { list_id: 1, from: '#宵夜', to: '' })).body, { updated: 1 });
  assert.deepEqual(tags()[1], '台中');
});
