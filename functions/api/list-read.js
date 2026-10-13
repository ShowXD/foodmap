import { findAccessibleList } from '../../lib/lists.js';

// Marks the list as seen now; places added after this show as "新" next time.
export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const list = await findAccessibleList(env.DB, data.user, body?.list_id);
  if (!list) return Response.json({ error: 'list not found' }, { status: 404 });
  await env.DB
    .prepare(
      `INSERT INTO list_reads (user_id, list_id, read_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, list_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP`,
    )
    .bind(data.user.id, list.id)
    .run();
  return Response.json({ ok: true });
}
