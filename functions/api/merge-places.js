import { findAccessiblePlace } from '../../lib/lists.js';
import { MAX_CAPTION_LENGTH } from '../../lib/social.js';

const json = (body, status = 200) => Response.json(body, { status });
const FILLED_FIELDS = ['name', 'dishes', 'area', 'address', 'tags'];
const MAX_NOTE_LENGTH = 2000;

/**
 * POST {place_id}: folds every place in the same list with the same Google place ID into the oldest one.
 * Blank fields are filled from the others, their links go into the note and their post text into the
 * caption, and everyone's 吃過 (rating, note), stars and the thumbnail move over. All in one transaction.
 */
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const access = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!access) return json({ error: 'not found' }, 404);
  const place = await env.DB.prepare('SELECT list_id, google_place_id FROM places WHERE id = ?').bind(access.id).first();
  if (!place.google_place_id) return json({ error: '這家店還沒定位，無法判斷是否重複' }, 400);
  const { results: same } = await env.DB
    .prepare('SELECT * FROM places WHERE list_id = ? AND google_place_id = ? ORDER BY created_at, id')
    .bind(place.list_id, place.google_place_id)
    .all();
  if (same.length < 2) return json({ error: '沒有重複的店' }, 409);

  const [kept, ...others] = same;
  const merged = Object.fromEntries(FILLED_FIELDS.map((field) => [field, [kept, ...others].map((row) => row[field]).find(Boolean) ?? '']));
  const captions = [...new Set([kept, ...others].map((row) => row.caption?.trim()).filter(Boolean))];
  const links = [...new Set(others.map((row) => row.url))].filter((url) => url !== kept.url).map((url) => `也出現在：${url}`);
  const notes = [...new Set([kept, ...others].map((row) => row.note?.trim()).filter(Boolean))];
  const keptId = kept.id;

  const statements = [
    env.DB
      .prepare(
        `UPDATE places SET name = ?, dishes = ?, area = ?, address = ?, tags = ?, caption = ?, note = ?, ai_pending = 0,
                hand_edited = ? WHERE id = ?`,
      )
      .bind(
        ...FILLED_FIELDS.map((field) => merged[field]),
        captions.join('\n---\n').slice(0, MAX_CAPTION_LENGTH),
        [...notes, ...links].join('\n').slice(0, MAX_NOTE_LENGTH),
        Math.max(...[kept, ...others].map((row) => row.hand_edited ?? 0)),
        keptId,
      ),
  ];
  for (const { id } of others) {
    statements.push(
      // Someone who marked both keeps one 吃過: the rating fills in if missing and the notes are joined.
      env.DB
        .prepare(
          `UPDATE place_visits AS k SET rating = COALESCE(k.rating, d.rating),
                  note = CASE WHEN COALESCE(k.note, '') = '' THEN d.note
                              WHEN COALESCE(d.note, '') = '' OR d.note = k.note THEN k.note
                              ELSE k.note || char(10) || d.note END
           FROM place_visits AS d WHERE k.place_id = ?1 AND d.place_id = ?2 AND d.user_id = k.user_id`,
        )
        .bind(keptId, id),
      env.DB
        .prepare('INSERT OR IGNORE INTO place_visits (user_id, place_id, visited_at, rating, note) SELECT user_id, ?, visited_at, rating, note FROM place_visits WHERE place_id = ?')
        .bind(keptId, id),
      env.DB
        .prepare('INSERT OR IGNORE INTO place_stars (user_id, place_id, created_at) SELECT user_id, ?, created_at FROM place_stars WHERE place_id = ?')
        .bind(keptId, id),
      // A failed thumbnail on the kept place gives way to a real one from a duplicate.
      env.DB
        .prepare(
          `DELETE FROM place_thumbnails WHERE place_id = ?1 AND image IS NULL
             AND EXISTS (SELECT 1 FROM place_thumbnails WHERE place_id = ?2 AND image IS NOT NULL)`,
        )
        .bind(keptId, id),
      env.DB
        .prepare('INSERT OR IGNORE INTO place_thumbnails (place_id, content_type, image, fetched_at) SELECT ?, content_type, image, fetched_at FROM place_thumbnails WHERE place_id = ? AND image IS NOT NULL')
        .bind(keptId, id),
      // Visits, stars and thumbnails left on the duplicate go with it (ON DELETE CASCADE).
      env.DB.prepare('DELETE FROM places WHERE id = ?').bind(id),
    );
  }
  await env.DB.batch(statements);
  return json({ kept_id: keptId, merged: others.length });
}
