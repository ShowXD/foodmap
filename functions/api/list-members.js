import { findUserByEmail } from '../../lib/users.js';
import { findAccessibleList, findManageableGroup } from '../../lib/lists.js';

const json = (body, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'list not found' }, 404);

// Any member may see who else is in the group.
export async function onRequestGet({ request, env, data }) {
  const listId = Number(new URL(request.url).searchParams.get('list'));
  const list = await findAccessibleList(env.DB, data.user, listId);
  if (!list || list.is_personal) return notFound();
  const { results } = await env.DB
    .prepare(
      `SELECT u.id AS user_id, u.email, m.is_owner FROM list_members m JOIN users u ON u.id = m.user_id
       WHERE m.list_id = ? ORDER BY m.is_owner DESC, u.email`,
    )
    .bind(list.id)
    .all();
  return json({ list, members: results, canManage: Boolean(list.is_owner || data.user.is_admin) });
}

// Adding someone by email is for site admins only. Anyone can start a group, so letting every owner do it
// would let strangers pull people in without asking and probe which emails are registered;
// owners invite with a link instead (invites.js), which the other person has to open.
export async function onRequestPost({ request, env, data }) {
  if (!data.user.is_admin) return json({ error: '請用「邀請連結」邀請成員' }, 403);
  const body = await request.json().catch(() => null);
  const list = await findManageableGroup(env.DB, data.user, body?.list_id);
  if (!list) return notFound();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const user = await findUserByEmail(env.DB, email);
  if (!user) return json({ error: '找不到這個 email，請對方先登入美食地圖一次' }, 404);
  // Only site admins hand out ownership.
  const isOwner = body.is_owner === true && data.user.is_admin ? 1 : 0;

  const result = await env.DB
    .prepare('INSERT INTO list_members (list_id, user_id, is_owner) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(list.id, user.id, isOwner)
    .run();
  if (!result.meta.changes) return json({ error: '這個人已經在群組裡了' }, 409);
  return json({ user_id: user.id, email: user.email, is_owner: isOwner }, 201);
}

export async function onRequestDelete({ request, env, data }) {
  const body = await request.json().catch(() => null);
  // Any member may leave a group; removing someone else takes an owner or site admin.
  const isLeaving = body?.user_id === data.user.id;
  const list = isLeaving
    ? await findAccessibleList(env.DB, data.user, body.list_id)
    : await findManageableGroup(env.DB, data.user, body?.list_id);
  if (!list || list.is_personal) return notFound();
  if (!Number.isInteger(body.user_id)) return json({ error: 'user_id required' }, 400);

  const member = await env.DB
    .prepare('SELECT is_owner FROM list_members WHERE list_id = ? AND user_id = ?')
    .bind(list.id, body.user_id)
    .first();
  if (!member) return json({ error: 'not a member' }, 404);
  // Owners can only be removed by a site admin, so a group never loses its owner by accident.
  if (member.is_owner && !data.user.is_admin) return json({ error: '只有網站管理員能移除擁有者' }, 403);

  await env.DB.prepare('DELETE FROM list_members WHERE list_id = ? AND user_id = ?').bind(list.id, body.user_id).run();
  return json({ ok: true });
}
