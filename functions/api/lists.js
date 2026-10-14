import { findUserByEmail } from '../../lib/users.js';
import { accessibleLists, ensurePersonalList } from '../../lib/lists.js';

const json = (body, status = 200) => Response.json(body, { status });

export async function onRequestGet({ env, data }) {
  // Users who registered before lists existed get their personal list on first use.
  await ensurePersonalList(env.DB, data.user);
  return json(await accessibleLists(env.DB, data.user));
}

// Keeps one account from filling the database with empty groups.
const MAX_OWNED_GROUPS = 10;

// Anyone may start a group and owns it. Only site admins may create one on someone else's behalf
// (that owner must have logged in at least once).
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const ownerEmail = data.user.is_admin && typeof body?.owner_email === 'string' ? body.owner_email.trim().toLowerCase() : '';
  if (!name || name.length > 50) return json({ error: '群組名稱必填，最多 50 字' }, 400);

  const owner = await findUserByEmail(env.DB, ownerEmail || data.user.email);
  if (!owner) return json({ error: '找不到這個 email，對方要先登入過一次' }, 404);
  if (!data.user.is_admin) {
    const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM list_members WHERE user_id = ? AND is_owner = 1').bind(owner.id).first();
    if (owned.n >= MAX_OWNED_GROUPS) return json({ error: `每人最多建立 ${MAX_OWNED_GROUPS} 個群組` }, 429);
  }

  const list = await env.DB.prepare('INSERT INTO lists (name, is_personal) VALUES (?, 0) RETURNING id, name, is_personal').bind(name).first();
  await env.DB.prepare('INSERT INTO list_members (list_id, user_id, is_owner) VALUES (?, ?, 1)').bind(list.id, owner.id).run();
  return json(list, 201);
}
