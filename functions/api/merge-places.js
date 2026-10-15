import { findAccessiblePlace } from '../../lib/lists.js';
import { mergeSamePlace } from '../../lib/merge.js';

const json = (body, status = 200) => Response.json(body, { status });

/**
 * POST {place_id}: merges places saved before automatic merging (see mergeSamePlace); new duplicates
 * are merged as soon as they are located.
 */
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const access = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!access) return json({ error: 'not found' }, 404);
  const place = await env.DB.prepare('SELECT google_place_id FROM places WHERE id = ?').bind(access.id).first();
  if (!place.google_place_id) return json({ error: '這家店還沒定位，無法判斷是否重複' }, 400);
  const merged = await mergeSamePlace(env.DB, access.id);
  return merged ? json(merged) : json({ error: '沒有重複的店' }, 409);
}
