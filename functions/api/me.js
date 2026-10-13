const MAX_NAME_LENGTH = 30;

export async function onRequestGet({ env, data }) {
  const { id, email, status, is_admin: isAdmin, display_name: name } = data.user;
  const avatar = await env.DB.prepare('SELECT updated_at FROM user_avatars WHERE user_id = ?').bind(id).first();
  return Response.json({ id, email, status, isAdmin: Boolean(isAdmin), name: name ?? null, avatarVersion: avatar?.updated_at ?? null });
}

/** PATCH {display_name}: an empty name goes back to the default (the part of the email before @). */
export async function onRequestPatch({ request, env, data }) {
  const body = await request.json().catch(() => null);
  if (typeof body?.display_name !== 'string') return Response.json({ error: 'display_name must be a string' }, { status: 400 });
  const name = body.display_name.trim();
  if (name.length > MAX_NAME_LENGTH) return Response.json({ error: `名稱最多 ${MAX_NAME_LENGTH} 字` }, { status: 400 });
  await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name || null, data.user.id).run();
  return Response.json({ name: name || null });
}
