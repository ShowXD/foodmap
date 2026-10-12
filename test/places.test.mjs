import assert from 'node:assert/strict';
import test from 'node:test';
import { isHttpUrl, pickFields, onRequestPost } from '../functions/api/places.js';

test('isHttpUrl only accepts http(s)', () => {
  assert.ok(isHttpUrl('https://www.instagram.com/reel/abc/'));
  assert.ok(isHttpUrl('http://fb.watch/xyz'));
  assert.ok(!isHttpUrl('javascript:alert(1)'));
  assert.ok(!isHttpUrl('not a url'));
});

test('pickFields keeps whitelisted strings and rejects bad input', () => {
  assert.deepEqual(pickFields({ name: ' 阿宗麵線 ', id: 5, url: 'x', evil: 'DROP' }), { fields: { name: '阿宗麵線' } });
  assert.deepEqual(pickFields({ status: 'eaten' }), { error: 'invalid status' });
  assert.deepEqual(pickFields({ name: 1 }), { error: 'name must be a string' });
  assert.deepEqual(pickFields({ name: 'x'.repeat(501) }), { error: 'name is too long' });
  assert.ok(pickFields({ caption: 'x'.repeat(5000) }).fields);
  assert.ok(!isHttpUrl(`https://example.com/${'x'.repeat(2048)}`));
});

test('POST rejects non-http url before touching the database', async () => {
  const request = new Request('http://localhost/api/places', {
    method: 'POST',
    body: JSON.stringify({ url: 'javascript:alert(1)' }),
  });
  const response = await onRequestPost({ request, env: {} });
  assert.equal(response.status, 400);
});
