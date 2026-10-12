const STATUSES = ['pending', 'approved', 'disabled'];
const json = (body, status = 200) => Response.json(body, { status });
const forbidden = () => json({ error: 'admin only' }, 403);

export async function onRequestGet({ env, data }) {
  if (!data.user.is_admin) return forbidden();
  const { results } = await env.DB
    .prepare("SELECT id, email, status, is_admin, created_at FROM users ORDER BY status = 'pending' DESC, created_at")
    .all();
  return json(results);
}

export async function onRequestPatch({ request, env, data }) {
  if (!data.user.is_admin) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || !Number.isInteger(body.id)) return json({ error: 'id required' }, 400);

  const updates = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return json({ error: 'invalid status' }, 400);
    updates.status = body.status;
  }
  if (body.is_admin !== undefined) {
    if (typeof body.is_admin !== 'boolean') return json({ error: 'is_admin must be boolean' }, 400);
    updates.is_admin = body.is_admin ? 1 : 0;
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) return json({ error: 'nothing to update' }, 400);
  // Stop admins from locking themselves out.
  if (body.id === data.user.id && (updates.status && updates.status !== 'approved' || updates.is_admin === 0)) {
    return json({ error: '不能停用或降級自己' }, 400);
  }

  const user = await env.DB
    .prepare(`UPDATE users SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ? RETURNING id, email, status, is_admin, created_at`)
    .bind(...Object.values(updates), body.id)
    .first();
  return user ? json(user) : json({ error: 'not found' }, 404);
}
