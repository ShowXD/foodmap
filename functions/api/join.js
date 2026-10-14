import { hashToken } from '../../lib/links.js';

const json = (body, status = 200) => Response.json(body, { status });

/**
 * POST {code}: join the group an invite link points to. Any signed-in person may use a valid code once;
 * someone already in the group doesn't use it up.
 */
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^[0-9a-f]{64}$/.test(code)) return json({ error: '邀請連結不完整，請再跟對方要一次' }, 400);
  const codeHash = await hashToken(code);

  const invite = await env.DB
    .prepare(
      `SELECT i.list_id, l.name FROM group_invites i JOIN lists l ON l.id = i.list_id
       WHERE i.code_hash = ? AND i.expires_at > CURRENT_TIMESTAMP`,
    )
    .bind(codeHash)
    .first();
  if (!invite) return json({ error: '邀請連結已過期或已經被用過，請再跟對方要一條新的' }, 410);

  const already = await env.DB.prepare('SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?').bind(invite.list_id, data.user.id).first();
  if (already) return json({ list_id: invite.list_id, list_name: invite.name, already_member: true });

  // Claiming the invite first keeps it single-use even if it is opened twice at once.
  const claimed = await env.DB.prepare('DELETE FROM group_invites WHERE code_hash = ? RETURNING list_id').bind(codeHash).first();
  if (!claimed) return json({ error: '邀請連結已過期或已經被用過，請再跟對方要一條新的' }, 410);
  await env.DB.prepare('INSERT INTO list_members (list_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(claimed.list_id, data.user.id).run();
  return json({ list_id: claimed.list_id, list_name: invite.name, already_member: false });
}
