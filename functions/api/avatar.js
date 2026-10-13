// The page shrinks photos to a 256px JPEG before uploading, so this limit is generous.
const MAX_AVATAR_BYTES = 300 * 1024;
// The bytes must really be the image type they claim, so nothing else can be served back as a "photo".
const SIGNATURES = {
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  'image/webp': (bytes) => String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP',
};

const json = (body, status = 200) => Response.json(body, { status });

export async function onRequestPut({ request, env, data }) {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!SIGNATURES[contentType]) return json({ error: '只接受 JPEG、PNG 或 WebP 圖片' }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return json({ error: '圖片太大了' }, 413);
  if (!SIGNATURES[contentType](bytes)) return json({ error: '檔案內容不是這種圖片' }, 415);

  const saved = await env.DB
    .prepare(
      `INSERT INTO user_avatars (user_id, content_type, image) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET content_type = ?2, image = ?3, updated_at = CURRENT_TIMESTAMP
       RETURNING updated_at`,
    )
    .bind(data.user.id, contentType, bytes)
    .first();
  return json({ avatarVersion: saved.updated_at });
}

export async function onRequestDelete({ env, data }) {
  await env.DB.prepare('DELETE FROM user_avatars WHERE user_id = ?').bind(data.user.id).run();
  return json({ avatarVersion: null });
}
