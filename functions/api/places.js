import { findAccessibleList, findAccessiblePlace } from '../../lib/lists.js';
import { expireGoogleLocations, refreshStaleLocations } from '../../lib/google.js';
import { retryPendingAi } from '../../lib/place-ai.js';
import { isHttpUrl, MAX_CAPTION_LENGTH } from '../../lib/social.js';
import { STORAGE_LIMITS, takeUserQuota } from '../../lib/usage.js';

const EDITABLE_FIELDS =['caption', 'name', 'dishes', 'area', 'address', 'tags', 'note', 'status'];
const SOURCES = new Set(['line', 'share', 'manual']);
const STATUSES = new Set(['todo', 'visited']);
// Caps keep one row small; captions mirror the AI extraction limit.
const MAX_FIELD_LENGTH = { caption: MAX_CAPTION_LENGTH, note: 2000 };
const DEFAULT_MAX_FIELD_LENGTH = 500;

const json = (body, status = 200) => Response.json(body, { status });

// Returns only whitelisted, string-valued fields, or an error message.
export function pickFields(body) {
  const fields = {};
  for (const key of EDITABLE_FIELDS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string') return { error: `${key} must be a string` };
    fields[key] = body[key].trim();
    if (fields[key].length > (MAX_FIELD_LENGTH[key] ?? DEFAULT_MAX_FIELD_LENGTH)) return { error: `${key} is too long` };
  }
  if (fields.status !== undefined && !STATUSES.has(fields.status)) {
    return { error: 'invalid status' };
  }
  return { fields };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const listNotFound = () => json({ error: 'list not found' }, 404);

export async function onRequestGet({ request, env, data, waitUntil }) {
  const params = new URL(request.url).searchParams;
  const list = await findAccessibleList(env.DB, data.user, Number(params.get('list')));
  if (!list) return listNotFound();
  await expireGoogleLocations(env.DB, list.id);
  if (env.GOOGLE_PLACES_KEY) waitUntil(refreshStaleLocations(env.DB, env.GOOGLE_PLACES_KEY, list.id));
  if (env.AI) waitUntil(retryPendingAi(env, list.id).catch((error) => console.error('AI retry failed', error.message)));

  // The whole list every time: the app searches it on the phone. Personal marks ride along so one request draws the whole list. "新" = added by someone
  // else after this user last opened the list (never on the very first visit).
  const { results } = await env.DB
    .prepare(
      `SELECT p.*,
              mv.visited_at AS my_visited_at, mv.rating AS my_rating, mv.note AS my_note,
              (SELECT COUNT(*) FROM place_visits v WHERE v.place_id = p.id) AS visit_count,
              (SELECT ROUND(AVG(v.rating), 1) FROM place_visits v WHERE v.place_id = p.id AND v.rating IS NOT NULL) AS avg_rating,
              CASE WHEN s.user_id IS NULL THEN 0 ELSE 1 END AS starred,
              CASE WHEN r.read_at IS NOT NULL AND p.created_at > r.read_at AND COALESCE(p.created_by, 0) <> ?2 THEN 1 ELSE 0 END AS is_new
       FROM places p
       LEFT JOIN place_visits mv ON mv.place_id = p.id AND mv.user_id = ?2
       LEFT JOIN place_stars s ON s.place_id = p.id AND s.user_id = ?2
       LEFT JOIN list_reads r ON r.list_id = p.list_id AND r.user_id = ?2
       WHERE p.list_id = ?1
       ORDER BY p.created_at DESC, p.id DESC`,
    )
    .bind(list.id, data.user.id)
    .all();
  return json(results);
}

export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid json' }, 400);
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!isHttpUrl(url)) return json({ error: 'url must be http(s)' }, 400);
  const list = await findAccessibleList(env.DB, data.user, body.list_id);
  if (!list) return listNotFound();
  const { fields, error } = pickFields(body);
  if (error) return json({ error }, 400);
  const source = SOURCES.has(body.source) ? body.source : 'manual';

  if (!(await takeUserQuota(env.DB, data.user.id, 'place_saves'))) {
    return json({ error: `今天已經新增 ${STORAGE_LIMITS.place_saves.perUserDaily} 家了，明天再繼續` }, 429);
  }
  // One video can feature several shops, so a duplicate is the same url *and* the same shop name in the same list.
  // Checked inside the INSERT so a double-tapped save can't slip two rows in between a check and the insert.
  const columns = ['list_id', 'created_by', 'url', 'source', ...Object.keys(fields)];
  const values = [list.id, data.user.id, url, source, ...Object.values(fields)];
  const place = await env.DB
    .prepare(
      `INSERT INTO places (${columns.join(', ')}) SELECT ${columns.map(() => '?').join(', ')}
       WHERE NOT EXISTS (SELECT 1 FROM places WHERE list_id = ? AND url = ? AND COALESCE(name, '') = ?) RETURNING *`,
    )
    .bind(...values, list.id, url, fields.name ?? '')
    .first();
  if (!place) return json({ error: 'already saved' }, 409);
  return json(place, 201);
}

export async function onRequestPatch({ request, env, data }) {
  const body = await readJson(request);
  if (!body || !Number.isInteger(body.id)) return json({ error: 'id required' }, 400);
  const { fields, error } = pickFields(body);
  if (error) return json({ error }, 400);
  const keys = Object.keys(fields);
  if (keys.length === 0) return json({ error: 'nothing to update' }, 400);

  // Report "not found" for places in lists the user can't see, so ids don't leak.
  if (!(await findAccessiblePlace(env.DB, data.user, body.id))) return json({ error: 'not found' }, 404);

  // Field names come from pickFields' allow-list, never from the request.
  const assignments = keys.map((key) => `${key} = ?`).join(', ');
  const place = await env.DB
    // Once a person edits it, the background AI retry leaves it alone.
    .prepare(`UPDATE places SET ${assignments}, ai_pending = 0 WHERE id = ? RETURNING *`)
    .bind(...Object.values(fields), body.id)
    .first();
  return json(place);
}
