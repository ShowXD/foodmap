import { findAccessiblePlace } from '../../lib/lists.js';
import { fetchRating, GoogleQuotaError } from '../../lib/google.js';
import { APIS, dayIn, recordUsage, takeUserQuota } from '../../lib/usage.js';

const json = (body, status = 200) => Response.json(body, { status });
const { dailyLimit, perUserDaily, timeZone } = APIS.place_rating;

/** GET ?place_id= → { rating, count } from Google, only when someone asks on a card. Never stored. */
export async function onRequestGet({ request, env, data }) {
  if (!env.GOOGLE_PLACES_KEY) return json({ error: 'Google 尚未設定' }, 503);
  const placeId = Number(new URL(request.url).searchParams.get('place_id'));
  const found = await findAccessiblePlace(env.DB, data.user, placeId);
  if (!found) return json({ error: 'not found' }, 404);
  const place = await env.DB.prepare('SELECT google_place_id FROM places WHERE id = ?').bind(found.id).first();
  if (!place.google_place_id) return json({ error: '這家店還沒用 Google 定位，查不到評分' }, 409);

  // The whole site's share of the free monthly amount comes first, so a person's own count isn't spent on a refusal.
  const today = await env.DB.prepare("SELECT count FROM api_usage WHERE api = 'place_rating' AND day = ?").bind(dayIn(timeZone)).first();
  if ((today?.count ?? 0) >= dailyLimit) return json({ error: '今天大家查 Google 評分的次數已用完，明天再試' }, 429);
  if (!(await takeUserQuota(env.DB, data.user.id, 'place_rating'))) {
    return json({ error: `你今天查 Google 評分已達 ${perUserDaily} 次，明天再試` }, 429);
  }
  try {
    await recordUsage(env.DB, 'place_rating');
    const rating = await fetchRating(env.GOOGLE_PLACES_KEY, place.google_place_id);
    return rating ? json(rating) : json({ error: 'Google 上找不到這家店了' }, 404);
  } catch (error) {
    if (error instanceof GoogleQuotaError) return json({ error: '今天的 Google 查詢次數已用完，請明天再試' }, 429);
    console.error('Rating lookup failed', error.message);
    return json({ error: 'Google 評分暫時查不到' }, 502);
  }
}
