// GET /avatar/:userId — only for the person themselves, people who share a group with them (photos show
// next to ratings), and site admins. Anyone else gets the same 404 as "no photo", so ids can't be probed.
// Pages add ?v=<updated_at>, so a long cache is safe: a new photo gets a new URL.
export async function onRequestGet({ params, env, data }) {
  const userId = Number(params.id);
  const viewer = data.user;
  const avatar = await env.DB
    .prepare(
      `SELECT a.content_type, a.image FROM user_avatars a
       WHERE a.user_id = ?1
         AND (?1 = ?2 OR ?3 = 1 OR EXISTS (
           SELECT 1 FROM list_members theirs JOIN list_members mine ON mine.list_id = theirs.list_id
           WHERE theirs.user_id = ?1 AND mine.user_id = ?2))`,
    )
    .bind(userId, viewer.id, viewer.is_admin ? 1 : 0)
    .first();
  if (!avatar) return new Response('no avatar', { status: 404 });
  // D1 hands BLOBs back as plain arrays of numbers.
  return new Response(new Uint8Array(avatar.image), {
    headers: { 'Content-Type': avatar.content_type, 'Cache-Control': 'private, max-age=2592000' },
  });
}
