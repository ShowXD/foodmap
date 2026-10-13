import { findManageableGroup } from '../../lib/lists.js';

// No 0/O or 1/I, so a code read off a phone screen is typed right the first time.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const VALID_FOR = '+30 minutes';

const json = (body, status = 200) => Response.json(body, { status });

export function newBindCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/**
 * POST {list_id}: a one-time code the group owner sends in their LINE group as「綁定 CODE」.
 * Making a new code cancels the previous one for that list.
 */
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const list = await findManageableGroup(env.DB, data.user, body?.list_id);
  if (!list) return json({ error: 'list not found' }, 404);

  const code = newBindCode();
  await env.DB.prepare('DELETE FROM line_bind_codes WHERE list_id = ? OR expires_at < CURRENT_TIMESTAMP').bind(list.id).run();
  const saved = await env.DB
    .prepare(`INSERT INTO line_bind_codes (code, list_id, created_by, expires_at) VALUES (?, ?, ?, datetime('now', '${VALID_FOR}')) RETURNING expires_at`)
    .bind(code, list.id, data.user.id)
    .first();
  const addFriendUrl = env.LINE_BOT_ID ? `https://line.me/R/ti/p/${encodeURIComponent(env.LINE_BOT_ID)}` : null;
  return json({ code, expires_at: saved.expires_at, add_friend_url: addFriendUrl }, 201);
}
