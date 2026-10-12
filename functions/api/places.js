const EDITABLE_FIELDS = ['caption', 'name', 'dishes', 'area', 'address', 'tags', 'note', 'status'];
const SEARCH_FIELDS = ['name', 'dishes', 'area', 'address', 'tags', 'note', 'caption'];
const SOURCES = ['line', 'share', 'manual'];
const STATUSES = ['todo', 'visited'];

const json = (body, status = 200) => Response.json(body, { status });

// Rejects javascript:/data: URLs, since the url is rendered as a link.
export function isHttpUrl(text) {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

// Returns only whitelisted, string-valued fields, or an error message.
export function pickFields(body) {
  const fields = {};
  for (const key of EDITABLE_FIELDS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string') return { error: `${key} must be a string` };
    fields[key] = body[key].trim();
  }
  if (fields.status !== undefined && !STATUSES.includes(fields.status)) {
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

export async function onRequestGet({ request, env }) {
  const query = new URL(request.url).searchParams.get('q')?.trim();
  // ponytail: LIKE full scan, fine for hundreds of rows; switch to FTS5 if it gets slow
  const where = query ? `WHERE ${SEARCH_FIELDS.map((f) => `${f} LIKE ?1`).join(' OR ')}` : '';
  const statement = env.DB.prepare(`SELECT * FROM places ${where} ORDER BY created_at DESC, id DESC`);
  const { results } = await (query ? statement.bind(`%${query}%`) : statement).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid json' }, 400);
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!isHttpUrl(url)) return json({ error: 'url must be http(s)' }, 400);
  const { fields, error } = pickFields(body);
  if (error) return json({ error }, 400);
  const source = SOURCES.includes(body.source) ? body.source : 'manual';

  // One video can feature several shops, so a duplicate is the same url *and* the same shop name.
  const existing = await env.DB
    .prepare("SELECT * FROM places WHERE url = ? AND COALESCE(name, '') = ?")
    .bind(url, fields.name ?? '')
    .first();
  if (existing) return json({ error: 'already saved', place: existing }, 409);

  const columns = ['url', 'source', ...Object.keys(fields)];
  const values = [url, source, ...Object.values(fields)];
  const place = await env.DB
    .prepare(`INSERT INTO places (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING *`)
    .bind(...values)
    .first();
  return json(place, 201);
}

export async function onRequestPatch({ request, env }) {
  const body = await readJson(request);
  if (!body || !Number.isInteger(body.id)) return json({ error: 'id required' }, 400);
  const { fields, error } = pickFields(body);
  if (error) return json({ error }, 400);
  const keys = Object.keys(fields);
  if (keys.length === 0) return json({ error: 'nothing to update' }, 400);

  const place = await env.DB
    .prepare(`UPDATE places SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`)
    .bind(...Object.values(fields), body.id)
    .first();
  return place ? json(place) : json({ error: 'not found' }, 404);
}
