import { findAccessiblePlace } from '../../lib/lists.js';
import { GoogleQuotaError, placeQuery, searchPlaces } from '../../lib/google.js';
import { APIS, recordUsage, takeUserQuota } from '../../lib/usage.js';

const MAX_QUERY_LENGTH = 100;
const json = (body, status = 200) => Response.json(body, { status });

/** POST {place_id, query?} → up to 3 Google candidates for where this shop is. Nothing is stored here. */
export async function onRequestPost({ request, env, data }) {
  if (!env.GOOGLE_PLACES_KEY) return json({ error: 'Google 地點搜尋尚未設定' }, 503);
  const body = await request.json().catch(() => null);
  const found = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!found) return json({ error: 'not found' }, 404);

  const place = await env.DB.prepare('SELECT name, area, address FROM places WHERE id = ?').bind(found.id).first();
  const query = (typeof body.query === 'string' && body.query.trim() ? body.query : placeQuery(place)).trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return json({ error: '請先填店名，或輸入要搜尋的文字' }, 400);
  if (!(await takeUserQuota(env.DB, data.user.id, 'places_search'))) {
    return json({ error: `你今天的地點搜尋已達 ${APIS.places_search.perUserDaily} 次，明天再試，或直接在地圖上放標點` }, 429);
  }
  try {
    await recordUsage(env.DB, 'places_search');
    return json({ query, candidates: await searchPlaces(env.GOOGLE_PLACES_KEY, query) });
  } catch (error) {
    if (error instanceof GoogleQuotaError) return json({ error: '今天的 Google 查詢次數已用完，請明天再試或直接在地圖上放標點' }, 429);
    console.error('Place search failed', error.message);
    return json({ error: 'Google 地點搜尋暫時失敗' }, 502);
  }
}
