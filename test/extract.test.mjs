import assert from 'node:assert/strict';
import test from 'node:test';
import { isSocialUrl, parseOgText, onRequestPost } from '../functions/api/extract.js';

const post = (body) => new Request('http://localhost/api/extract', { method: 'POST', body: JSON.stringify(body) });

test('isSocialUrl only allows IG/FB hosts', () => {
  assert.ok(isSocialUrl('https://www.instagram.com/reel/abc/'));
  assert.ok(isSocialUrl('https://m.facebook.com/watch?v=1'));
  assert.ok(isSocialUrl('https://fb.watch/xyz'));
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

test('extract returns 503 when the API key is missing', async () => {
  const response = await onRequestPost({ request: post({ caption: 'x' }), env: {} });
  assert.equal(response.status, 503);
});

test('extract asks for caption when it cannot fetch one', async () => {
  const response = await onRequestPost({ request: post({ url: 'https://example.com/' }), env: { ANTHROPIC_API_KEY: 'test' } });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).needCaption, true);
});
