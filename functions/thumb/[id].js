import { findAccessiblePlace } from '../../lib/lists.js';
import { fetchThumbnail } from '../../lib/social.js';
import { takeUserQuota } from '../../lib/usage.js';

const RETRY_FAILED_AFTER = '-3 days';

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
