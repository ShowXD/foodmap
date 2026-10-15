// A YouTube video's full text for the AI: its title, the whole description (the page's og tags cut it
// short) and the top comments, read with the YouTube Data API and the server's Google key.
// Needs "YouTube Data API v3" enabled for that key (docs/setup/google.md); without it this returns ''
// and the caller falls back to the page's og tags.
import { recordUsage } from './usage.js';

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_COMMENTS = 10;

const asVideoId = (id) => (/^[\w-]{11}$/.test(id ?? '') ? id : null);

/** The 11-character id in watch, Shorts, live, embed and youtu.be links; null for anything else. */
export function youtubeVideoId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host === 'youtu.be') return asVideoId(parsed.pathname.slice(1));
  if (host !== 'youtube.com') return null;
  if (parsed.pathname === '/watch') return asVideoId(parsed.searchParams.get('v'));
  return asVideoId(/^\/(?:shorts|live|embed)\/([^/?]+)/.exec(parsed.pathname)?.[1]);
}

async function call(env, resource, params) {
  await recordUsage(env.DB, 'youtube');
  const query = new URLSearchParams({ ...params, key: env.GOOGLE_PLACES_KEY });
  const response = await fetch(`${API}/${resource}?${query}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`YouTube ${resource} ${response.status}`);
  return response.json();
}

/** Title, description and top comments of a YouTube link, or '' when it isn't one or can't be read. */
export async function fetchYoutubeText(env, url) {
  const videoId = youtubeVideoId(url);
  if (!videoId || !env.GOOGLE_PLACES_KEY) return '';
  try {
    const snippet = (await call(env, 'videos', { part: 'snippet', id: videoId })).items?.[0]?.snippet;
    if (!snippet) return '';
    // Comments are a bonus: they may be turned off, which the API answers with an error.
    const threads = await call(env, 'commentThreads', {
      part: 'snippet', videoId, maxResults: String(MAX_COMMENTS), order: 'relevance', textFormat: 'plainText',
    }).catch(() => null);
    const comments = (threads?.items ?? []).map((item) => item.snippet?.topLevelComment?.snippet?.textDisplay).filter(Boolean);
    return [snippet.title, snippet.description, comments.length ? `留言：\n${comments.join('\n')}` : '']
      .filter(Boolean).join('\n');
  } catch (error) {
    console.warn('YouTube text unavailable', videoId, error.message);
    return '';
  }
}
