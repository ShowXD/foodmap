import { findAccessiblePlace } from '../../lib/lists.js';
import { fetchSocialPage, isSocialUrl, readLimited, readOgMeta } from '../../lib/social.js';
import { takeUserQuota } from '../../lib/usage.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 1024 * 1024;
const RETRY_FAILED_AFTER = '-3 days';

/** The post's og:image, downloaded now because the IG/FB CDN link stops working after a while. */
export async function fetchThumbnail(url) {
  if (!isSocialUrl(url)) return null;
  const imageUrl = readOgMeta(await fetchSocialPage(url), 'og:image');
  if (!imageUrl.startsWith('https://')) return null;
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || !IMAGE_TYPES.has(contentType)) {
      await response.body?.cancel();
      return null;
    }
    const { bytes, truncated } = await readLimited(response, MAX_IMAGE_BYTES);
    return truncated ? null : { contentType, bytes };
  } catch (error) {
    console.warn('Thumbnail fetch failed', url, error.message);
    return null;
  }
}

const notFound = () => new Response('no thumbnail', { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } });

// GET /thumb/:placeId — fetched on first view and kept, so lists never wait on IG/FB twice.
export async function onRequestGet({ params, env, data }) {
  const place = await findAccessiblePlace(env.DB, data.user, Number(params.id));
  if (!place) return new Response('not found', { status: 404 });

  let stored = await env.DB
    .prepare(`SELECT content_type, image, fetched_at >= datetime('now', '${RETRY_FAILED_AFTER}') AS is_recent FROM place_thumbnails WHERE place_id = ?`)
    .bind(place.id)
    .first();
  if (!stored?.image && !stored?.is_recent) {
    // Over today's cap: show the placeholder without recording a failure, so it is fetched another day.
    if (!(await takeUserQuota(env.DB, data.user.id, 'thumbnails'))) return notFound();
    const { url } = await env.DB.prepare('SELECT url FROM places WHERE id = ?').bind(place.id).first();
    const thumbnail = await fetchThumbnail(url);
    await env.DB
      .prepare(
        `INSERT INTO place_thumbnails (place_id, content_type, image) VALUES (?1, ?2, ?3)
         ON CONFLICT (place_id) DO UPDATE SET content_type = ?2, image = ?3, fetched_at = CURRENT_TIMESTAMP`,
      )
      .bind(place.id, thumbnail?.contentType ?? null, thumbnail?.bytes ?? null)
      .run();
    stored = thumbnail && { content_type: thumbnail.contentType, image: thumbnail.bytes };
  }
  if (!stored?.image) return notFound();
  // D1 hands BLOBs back as plain arrays of numbers.
  return new Response(new Uint8Array(stored.image), {
    headers: { 'Content-Type': stored.content_type, 'Cache-Control': 'private, max-age=604800' },
  });
}
