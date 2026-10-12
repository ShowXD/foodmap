import { accessibleLists, ensurePersonalList } from '../../lib/lists.js';

const json = (body, status = 200) => Response.json(body, { status });

export async function onRequestGet({ env, data }) {
  // Users who registered before lists existed get their personal list on first use.
  await ensurePersonalList(env.DB, data.user);
  return json(await accessibleLists(env.DB, data.user));
}

// Only site admins create groups; the owner must have logged in at least once.
export async function onRequestPost({ request, env, data }) {
  if (!data.user.is_admin) return json({ error: 'admin only' }, 403);
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const ownerEmail = typeof body?.owner_email === 'string' ? body.owner_email.trim().toLowerCase() : '';
  if (!name || name.length > 50) return json({ error: '群組名稱必填，最多 50 字' }, 400);

  const owner = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(ownerEmail || data.user.email).first();
  if (!owner) return json({ error: '找不到這個 email，對方要先登入過一次' }, 404);

  const list = await env.DB.prepare('INSERT INTO lists (name, is_personal) VALUES (?, 0) RETURNING id, name, is_personal').bind(name).first();
  await env.DB.prepare('INSERT INTO list_members (list_id, user_id, is_owner) VALUES (?, ?, 1)').bind(list.id, owner.id).run();
  return json(list, 201);
}
