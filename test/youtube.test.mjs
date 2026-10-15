import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { fetchYoutubeText, youtubeVideoId } from '../lib/youtube.js';

test('youtubeVideoId reads watch, Shorts, live, embed and youtu.be links, and nothing else', () => {
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=AbCdEfGhIjk&t=10s'), 'AbCdEfGhIjk');
  assert.equal(youtubeVideoId('https://m.youtube.com/shorts/AbCdEfGhIjk?feature=share'), 'AbCdEfGhIjk');
  assert.equal(youtubeVideoId('https://youtube.com/live/AbCdEfGhIjk'), 'AbCdEfGhIjk');
  assert.equal(youtubeVideoId('https://www.youtube.com/embed/AbCdEfGhIjk'), 'AbCdEfGhIjk');
  assert.equal(youtubeVideoId('https://youtu.be/AbCdEfGhIjk?si=x'), 'AbCdEfGhIjk');
  assert.equal(youtubeVideoId('https://www.youtube.com/@foodie'), null);
  assert.equal(youtubeVideoId('https://www.instagram.com/reel/AbCdEfGhIjk/'), null);
  assert.equal(youtubeVideoId('https://notyoutube.com/watch?v=AbCdEfGhIjk'), null);
  assert.equal(youtubeVideoId('https://youtu.be/../../etc'), null);
});

test('fetchYoutubeText joins title, full description and top comments; comments are optional', async () => {
  const DB = createTestDb();
  const realFetch = globalThis.fetch;
  const requested = [];
  let commentsOff = false;
  globalThis.fetch = async (url) => {
    requested.push(new URL(url).pathname.split('/').pop());
    if (url.includes('/videos?')) return Response.json({ items: [{ snippet: { title: '台中必吃餛飩', description: '江家餛飩\n臺中市西區華美街204號' } }] });
    if (commentsOff) return new Response('{}', { status: 403 });
    return Response.json({ items: [{ snippet: { topLevelComment: { snippet: { textDisplay: '週日公休喔' } } } }] });
  };
  try {
    const env = { DB, GOOGLE_PLACES_KEY: 'test-key' };
    assert.equal(await fetchYoutubeText(env, 'https://youtu.be/AbCdEfGhIjk'), '台中必吃餛飩\n江家餛飩\n臺中市西區華美街204號\n留言：\n週日公休喔');
    commentsOff = true;
    assert.equal(await fetchYoutubeText(env, 'https://youtu.be/AbCdEfGhIjk'), '台中必吃餛飩\n江家餛飩\n臺中市西區華美街204號');
    assert.deepEqual(requested, ['videos', 'commentThreads', 'videos', 'commentThreads']);
    assert.equal(DB.sqlite.prepare("SELECT SUM(count) AS n FROM api_usage WHERE api = 'youtube'").get().n, 4);

    // Not YouTube, or no key: nothing is requested and the caller uses the page's og tags instead.
    requested.length = 0;
    assert.equal(await fetchYoutubeText(env, 'https://www.instagram.com/reel/a/'), '');
    assert.equal(await fetchYoutubeText({ DB }, 'https://youtu.be/AbCdEfGhIjk'), '');
    assert.deepEqual(requested, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});
