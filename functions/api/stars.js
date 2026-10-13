import { findAccessiblePlace } from '../../lib/lists.js';

const json = (body, status = 200) => Response.json(body, { status });

async function placeFor(request, env, data) {
  const body = await request.json().catch(() => null);
  return findAccessiblePlace(env.DB, data.user, body?.place_id);
}

export async function onRequestPut({ request, env, data }) {
  const place = await placeFor(request, env, data);
  if (!place) return json({ error: 'not found' }, 404);
  await env.DB.prepare('INSERT INTO place_stars (user_id, place_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(data.user.id, place.id).run();
  return json({ starred: true });
}

export async function onRequestDelete({ request, env, data }) {
  const place = await placeFor(request, env, data);
  if (!place) return json({ error: 'not found' }, 404);
  await env.DB.prepare('DELETE FROM place_stars WHERE user_id = ? AND place_id = ?').bind(data.user.id, place.id).run();
  return json({ starred: false });
}
