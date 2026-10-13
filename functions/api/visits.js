import { findAccessiblePlace } from '../../lib/lists.js';

const json = (body, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'not found' }, 404);
const MAX_NOTE_LENGTH = 500;

// Everyone who can see the place can read the family's ratings and notes for it.
export async function onRequestGet({ request, env, data }) {
  const place = await findAccessiblePlace(env.DB, data.user, Number(new URL(request.url).searchParams.get('place')));
  if (!place) return notFound();
  const { results } = await env.DB
    .prepare(
      `SELECT u.email, v.visited_at, v.rating, v.note, v.user_id = ?2 AS is_mine
       FROM place_visits v JOIN users u ON u.id = v.user_id WHERE v.place_id = ?1 ORDER BY v.visited_at DESC`,
    )
    .bind(place.id, data.user.id)
    .all();
  return json(results);
}

export async function onRequestPut({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const place = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!place) return notFound();
  const rating = body.rating ?? null;
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return json({ error: 'rating must be 1-5' }, 400);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_NOTE_LENGTH) return json({ error: 'note is too long' }, 400);

  const visit = await env.DB
    .prepare(
      `INSERT INTO place_visits (user_id, place_id, rating, note) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, place_id) DO UPDATE SET rating = excluded.rating, note = excluded.note
       RETURNING visited_at, rating, note`,
    )
    .bind(data.user.id, place.id, rating, note || null)
    .first();
  return json(visit);
}

export async function onRequestDelete({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const place = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!place) return notFound();
  await env.DB.prepare('DELETE FROM place_visits WHERE user_id = ? AND place_id = ?').bind(data.user.id, place.id).run();
  return json({ ok: true });
}
