import { findAccessiblePlace } from '../../lib/lists.js';
import { APIS, recordUsage, takeUserQuota } from '../../lib/usage.js';
import { extractPlaces } from '../../lib/ai.js';
import { fillFromAi } from '../../lib/place-ai.js';

const json = (body, status = 200) => Response.json(body, { status });

/** POST {place_id}: runs AI again on a nameless place's saved post text, fills it in and locates it. */
export async function onRequestPost({ request, env, data }) {
  if (!env.AI) return json({ error: 'AI 擷取尚未設定 Workers AI 綁定' }, 503);
  const body = await request.json().catch(() => null);
  const access = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!access) return json({ error: 'not found' }, 404);
  const place = await env.DB.prepare('SELECT * FROM places WHERE id = ?').bind(access.id).first();
  if (place.name) return json({ error: '這家店已經有店名了' }, 409);
  if (!place.caption) return json({ error: '沒有存到貼文文字，請按「編輯」貼上貼文後用 AI 自動填入' }, 422);
  if (!(await takeUserQuota(env.DB, data.user.id, 'workers_ai'))) {
    return json({ error: `今天的 AI 擷取已達 ${APIS.workers_ai.perUserDaily} 次上限，明天再試` }, 429);
  }

  await recordUsage(env.DB, 'workers_ai');
  const { places = [], error } = await extractPlaces(env.AI, place.caption);
  if (error === 'unavailable') return json({ error: 'AI 暫時無法使用（可能已達今日免費額度），明天再試' }, 502);
  if (error === 'unusable') return json({ error: 'AI 回傳格式錯誤，請再試一次或手動填寫' }, 502);
  if (places.length === 0) return json({ error: 'AI 在貼文裡找不到店家，請手動填寫' }, 422);
  const { located } = await fillFromAi(env, place, places);
  // located false: it has a name now but Google gave no sure match, so the app asks the person to pick.
  return json({ shops: places.length, located });
}
