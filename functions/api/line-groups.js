import { findManageableGroup } from '../../lib/lists.js';

const json = (body, status = 200) => Response.json(body, { status });
const forbidden = () => json({ error: 'admin only' }, 403);

const GROUP_COLUMNS = 'g.group_id, g.list_id, l.name AS list_name, g.first_seen_at, g.last_message_at';

// Site admins see every LINE group; a group owner (?list=ID) sees only the ones feeding their list.
// Owners bind new LINE groups themselves with a code (see line-bind-code.js and the webhook).
export async function onRequestGet({ request, env, data }) {
  const listId = new URL(request.url).searchParams.get('list');
  if (listId !== null) {
    const list = await findManageableGroup(env.DB, data.user, Number(listId));
    if (!list) return json({ error: 'list not found' }, 404);
    const { results } = await env.DB
      .prepare(`SELECT ${GROUP_COLUMNS} FROM line_groups g JOIN lists l ON l.id = g.list_id WHERE g.list_id = ? ORDER BY g.last_message_at DESC`)
      .bind(list.id)
      .all();
    return json(results);
  }
  if (!data.user.is_admin) return forbidden();
  const { results } = await env.DB
    .prepare(
      `SELECT ${GROUP_COLUMNS} FROM line_groups g LEFT JOIN lists l ON l.id = g.list_id
       ORDER BY g.last_message_at DESC, g.first_seen_at DESC`,
    )
    .all();
  return json(results);
}

// Site admins may bind or unbind any group; an owner may only unbind (list_id: null) a group feeding their list.
export async function onRequestPatch({ request, env, data }) {
  const body = await request.json().catch(() => null);
  if (typeof body?.group_id !== 'string') return json({ error: 'group_id required' }, 400);
  const listId = body.list_id ?? null;

  if (!data.user.is_admin) {
    if (listId !== null) return forbidden();
    const current = await env.DB.prepare('SELECT list_id FROM line_groups WHERE group_id = ?').bind(body.group_id).first();
    if (!current?.list_id || !(await findManageableGroup(env.DB, data.user, current.list_id))) return json({ error: 'not found' }, 404);
  } else if (listId !== null) {
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
