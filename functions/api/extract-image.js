import { extractPlacesFromImage } from '../../lib/ai.js';
import { APIS, recordUsage, takeUserQuota } from '../../lib/usage.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// The app shrinks screenshots to ~1280 px JPEG before sending, which is well under this.
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const json = (body, status = 200) => Response.json(body, { status });

/** POST (image body): the shops AI reads from a screenshot, plus its text as `caption`. Nothing is saved. */
export async function onRequestPost({ request, env, data }) {
  if (!env.AI) return json({ error: 'AI 擷取尚未設定 Workers AI 綁定' }, 503);
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(contentType)) return json({ error: '請選 JPG、PNG 或 WebP 圖片' }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return json({ error: '沒有收到圖片' }, 400);
  if (bytes.length > MAX_IMAGE_BYTES) return json({ error: '圖片太大，請換一張小一點的截圖' }, 413);
  if (!(await takeUserQuota(env.DB, data.user.id, 'workers_ai'))) {
    return json({ error: `今天的 AI 擷取已達 ${APIS.workers_ai.perUserDaily} 次上限，請手動填寫或明天再試` }, 429);
  }

  await recordUsage(env.DB, 'workers_ai');
  const { caption, places, error } = await extractPlacesFromImage(env.AI, bytes, contentType);
  if (error === 'unavailable') return json({ error: 'AI 暫時無法使用（可能已達今日免費額度），請手動填寫' }, 502);
  if (error === 'unusable') return json({ error: '看不出圖片裡的文字，換一張清楚一點的截圖再試' }, 422);
  if (places.length === 0) return json({ error: '截圖裡找不到店家，請手動填寫', caption }, 422);
  return json({ caption, places });
}
