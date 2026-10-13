import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { onRequestGet as getThumb } from '../functions/thumb/[id].js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const POST_PAGE = '<html><head><meta property="og:image" content="https://cdn.example.test/a.png?x=1&amp;y=2"></head></html>';

// Social pages and the image CDN are faked; every request is recorded.
const sent = [];
let imageReply = () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
globalThis.fetch = async (url) => {
  sent.push(String(url));
  if (String(url).startsWith('https://cdn.example.test/')) return imageReply();
  return new Response(POST_PAGE, { headers: { 'Content-Type': 'text/html' } });
};

async function setup() {
  const DB = createTestDb();
  const mom = await ensureUser(DB, 'mom@example.test', {});
  const stranger = await ensureUser(DB, 'stranger@example.test', {});
  DB.sqlite.exec(`INSERT INTO lists (id, name, is_personal) VALUES (1, '家人', 0);
    INSERT INTO list_members (list_id, user_id) VALUES (1, ${mom.id});
    INSERT INTO places (id, list_id, url, name) VALUES (10, 1, 'https://www.instagram.com/reel/a/', '阿宗麵線'),
      (11, 1, 'https://example.com/not-social', '別的網站');`);
  const get = (id, user = mom) => getThumb({ params: { id: String(id) }, env: { DB }, data: { user } });
  return { DB, stranger, get };
}

test('og:image is downloaded once, stored, and served to list members only', async () => {
  const { stranger, get } = await setup();
  sent.length = 0;
  const first = await get(10);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PNG);
  assert.deepEqual(sent, ['https://www.instagram.com/reel/a/', 'https://cdn.example.test/a.png?x=1&y=2']);

  sent.length = 0;
  assert.equal((await get(10)).status, 200);
  assert.equal(sent.length, 0, 'second view comes from the database');
  assert.equal((await get(10, stranger)).status, 404);
});

test('non-social links, non-images and oversized images give no thumbnail, and failures are not retried right away', async () => {
  const { DB, get } = await setup();
  sent.length = 0;
  assert.equal((await get(11)).status, 404);
  assert.equal(sent.length, 0, 'never fetches arbitrary sites');

  imageReply = () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal((await get(10)).status, 404);
  sent.length = 0;
  assert.equal((await get(10)).status, 404);
  assert.equal(sent.length, 0, 'a recent failure is remembered');

  DB.sqlite.exec("UPDATE place_thumbnails SET fetched_at = datetime('now', '-4 days')");
  imageReply = () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg' } });
  assert.equal((await get(10)).status, 404);
  imageReply = () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
});
