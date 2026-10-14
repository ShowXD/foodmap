import { findManageableGroup } from '../../lib/lists.js';
import { hashToken, randomToken } from '../../lib/links.js';

// An invite link lets one person join a group without the owner adding them by email.
const VALID_FOR = '+7 days';
const MAX_ACTIVE_INVITES = 20;

const json = (body, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'list not found' }, 404);

/** GET ?list=ID: the group's unused, unexpired invites (owner or site admin). */
export async function onRequestGet({ request, env, data }) {
  const list = await findManageableGroup(env.DB, data.user, Number(new URL(request.url).searchParams.get('list')));
  if (!list) return notFound();
  const { results } = await env.DB
    .prepare('SELECT id, created_at, expires_at FROM group_invites WHERE list_id = ? AND expires_at > CURRENT_TIMESTAMP ORDER BY id DESC')
    .bind(list.id)
    .all();
  return json(results);
}

/** POST {list_id}: a new invite; the code is only ever shown in this response. */
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const list = await findManageableGroup(env.DB, data.user, body?.list_id);
  if (!list) return notFound();

  await env.DB.prepare('DELETE FROM group_invites WHERE expires_at < CURRENT_TIMESTAMP').run();
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM group_invites WHERE list_id = ?').bind(list.id).first();
  if (active.n >= MAX_ACTIVE_INVITES) return json({ error: `這個群組已有 ${MAX_ACTIVE_INVITES} 條還沒用的邀請連結，請先作廢一些` }, 429);

  const code = randomToken();
  const invite = await env.DB
    .prepare(`INSERT INTO group_invites (code_hash, list_id, created_by, expires_at) VALUES (?, ?, ?, datetime('now', '${VALID_FOR}')) RETURNING id, expires_at`)
    .bind(await hashToken(code), list.id, data.user.id)
    .first();
  return json({ id: invite.id, code, expires_at: invite.expires_at, list_name: list.name }, 201);
}

/** DELETE {id}: revoke an invite of a group you manage. */
export async function onRequestDelete({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const invite = Number.isInteger(body?.id)
    ? await env.DB.prepare('SELECT id, list_id FROM group_invites WHERE id = ?').bind(body.id).first()
    : null;
  if (!invite || !(await findManageableGroup(env.DB, data.user, invite.list_id))) return json({ error: 'not found' }, 404);
  await env.DB.prepare('DELETE FROM group_invites WHERE id = ?').bind(invite.id).run();
  return json({ ok: true });
}
