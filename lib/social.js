// Reading IG/FB/Threads/YouTube links: which URLs are allowed, and the post text in a page's og tags.

const MAX_URL_LENGTH = 2048;
// Post text kept per place and sent to the AI.
export const MAX_CAPTION_LENGTH = 5000;
const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'fb.watch', 'fb.com', 'threads.net', 'threads.com', 'youtube.com', 'youtu.be'];
// og tags sit in <head>, so the first 512 KB is plenty and caps memory per request.
const MAX_PAGE_BYTES = 512 * 1024;

// Rejects javascript:/data: URLs, since the url is rendered as a link.
export function isHttpUrl(text) {
  if (typeof text !== 'string' || text.length > MAX_URL_LENGTH) return false;
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

// Only fetch known social hosts so the app can't be used to probe arbitrary URLs.
export function isSocialUrl(text) {
  if (!isHttpUrl(text)) return false;
  const host = new URL(text).hostname.toLowerCase();
  return SOCIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

// Reads one og:* meta tag; attribute order differs between sites, so match both orders.
export function readOgMeta(html, property) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const match = html.match(pattern);
  return match ? decodeEntities(match[1] ?? match[2]).trim() : '';
}

export function parseOgText(html) {
  return [...new Set([readOgMeta(html, 'og:title'), readOgMeta(html, 'og:description')].filter(Boolean))].join('\n');
}

/** The start of an IG/FB/Threads/YouTube page (where the og tags are), or '' when it can't be read. */
export async function fetchSocialPage(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'zh-TW,zh;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    // Redirects (e.g. l.facebook.com link shims) could land on any host; only read IG/FB pages.
    if (!response.ok || !isSocialUrl(response.url || url)) {
      await response.body?.cancel();
      return '';
    }
    return new TextDecoder().decode((await readLimited(response, MAX_PAGE_BYTES)).bytes);
  } catch (error) {
    console.warn('Social page fetch failed', url, error.message);
    return '';
  }
}

export const fetchCaption = async (url) => parseOgText(await fetchSocialPage(url));

/** Reads at most maxBytes; `truncated` is true once the limit is reached (a body of exactly maxBytes counts too). */
export async function readLimited(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      truncated = true;
      break;
    }
  }
  await reader.cancel();
  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, bytes.length - offset);
    bytes.set(slice, offset);
    offset += slice.byteLength;
  }
  return { bytes, truncated };
}
