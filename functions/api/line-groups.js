const json = (body, status = 200) => Response.json(body, { status });
const forbidden = () => json({ error: 'admin only' }, 403);

// Site admins decide which LINE group feeds which list; unbound groups are ignored by the webhook.
export async function onRequestGet({ env, data }) {
  if (!data.user.is_admin) return forbidden();
  const { results } = await env.DB
    .prepare(
      `SELECT g.group_id, g.list_id, l.name AS list_name, g.first_seen_at, g.last_message_at
       FROM line_groups g LEFT JOIN lists l ON l.id = g.list_id
       ORDER BY g.last_message_at DESC, g.first_seen_at DESC`,
    )
    .all();
  return json(results);
}

export async function onRequestPatch({ request, env, data }) {
  if (!data.user.is_admin) return forbidden();
  const body = await request.json().catch(() => null);
  if (typeof body?.group_id !== 'string') return json({ error: 'group_id required' }, 400);
  const listId = body.list_id ?? null;
  if (listId !== null) {
    if (!Number.isInteger(listId)) return json({ error: 'list_id must be an integer or null' }, 400);
    // Personal lists are private, so a group chat can't write into one.
    const list = await env.DB.prepare('SELECT id FROM lists WHERE id = ? AND is_personal = 0').bind(listId).first();
    if (!list) return json({ error: '只能綁定到群組清單' }, 400);
  }
  const group = await env.DB
    .prepare('UPDATE line_groups SET list_id = ? WHERE group_id = ? RETURNING group_id, list_id')
    .bind(listId, body.group_id)
    .first();
  return group ? json(group) : json({ error: 'not found' }, 404);
}
