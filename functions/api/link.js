import { startLink } from '../../lib/links.js';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

/** GET: every email that signs in to this account — the main one first, then linked ones. */
export async function onRequestGet({ env, data }) {
  const { results } = await env.DB
    .prepare('SELECT email, linked_at FROM user_identities WHERE user_id = ? ORDER BY linked_at')
    .bind(data.user.id)
    .all();
  return json([
    { email: data.user.email, is_main: true, is_current: data.user.email === data.loginEmail },
    ...results.map((row) => ({ email: row.email, is_main: false, is_current: row.email === data.loginEmail, linked_at: row.linked_at })),
  ]);
}

/** POST: start linking; the browser gets the one-time cookie, then signs out and back in with the other account. */
export async function onRequestPost({ env, data }) {
  return json({ ok: true }, 200, { 'Set-Cookie': await startLink(env.DB, data.user.id) });
}

/** DELETE {email}: unlink one extra sign-in (not the main email, and not the one in use right now). */
export async function onRequestDelete({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === data.loginEmail) return json({ error: '不能解除你現在正在使用的登入方式' }, 400);
  const removed = await env.DB.prepare('DELETE FROM user_identities WHERE email = ? AND user_id = ? RETURNING email').bind(email, data.user.id).first();
  return removed ? json({ ok: true }) : json({ error: 'not found' }, 404);
}
