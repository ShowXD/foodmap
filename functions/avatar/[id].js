// GET /avatar/:userId — any signed-in family member may see everyone's photo (shown next to ratings).
// Pages add ?v=<updated_at>, so a long cache is safe: a new photo gets a new URL.
export async function onRequestGet({ params, env }) {
  const avatar = await env.DB.prepare('SELECT content_type, image FROM user_avatars WHERE user_id = ?').bind(Number(params.id)).first();
  if (!avatar) return new Response('no avatar', { status: 404 });
  // D1 hands BLOBs back as plain arrays of numbers.
  return new Response(new Uint8Array(avatar.image), {
    headers: { 'Content-Type': avatar.content_type, 'Cache-Control': 'private, max-age=2592000' },
  });
}
