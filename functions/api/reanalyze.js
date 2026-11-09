import { findAccessiblePlace } from '../../lib/lists.js';
import { APIS, recordUsage, takeUserQuota } from '../../lib/usage.js';
import { aiModel, extractPlaces, garbledFields } from '../../lib/ai.js';
import { fillFromAi, shopsOnCover, withCoverText } from '../../lib/place-ai.js';
import { fetchCaption, isSocialUrl, MAX_CAPTION_LENGTH } from '../../lib/social.js';
import { fetchYoutubeText } from '../../lib/youtube.js';

const json = (body, status = 200) => Response.json(body, { status });

/** POST {place_id}: runs AI again on a nameless, garbled or unlocated (沒定位) place's saved post text, fixes it and locates it. */
export async function onRequestPost({ request, env, data }) {
  if (!env.AI) return json({ error: 'AI 擷取尚未設定 Workers AI 綁定' }, 503);
  const body = await request.json().catch(() => null);
  const access = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!access) return json({ error: 'not found' }, 404);
  const place = await env.DB.prepare('SELECT * FROM places WHERE id = ?').bind(access.id).first();
  // Nameless places, and places whose name/address/area look garbled (see garbledFields).
  const garbled = garbledFields(place);
  // Named but never placed (沒定位): the AI may read the post better this time. A Google place whose
  // coordinates only expired (30-day terms) keeps its place ID and is refetched, never re-analysed.
  const isUnlocated = Boolean(place.name) && place.lat == null && !place.google_place_id;
  if (place.name && garbled.length === 0 && !isUnlocated) return json({ error: '這家店已經有店名和定位了' }, 409);
  const saveCaption = (text) => env.DB.prepare('UPDATE places SET caption = ? WHERE id = ?').bind(text, place.id).run();
  let caption = place.caption ?? '';
  const isSocial = isSocialUrl(place.url);
  // Reading the post may have failed when the link was saved: try once more and keep what comes back.
  if (!caption && isSocial) {
    caption = ((await fetchYoutubeText(env, place.url)) || (await fetchCaption(place.url))).slice(0, MAX_CAPTION_LENGTH);
    if (caption) await saveCaption(caption);
  }
  const noText = () => json({ error: '抓不到貼文文字，請按「編輯」貼上貼文後用 AI 自動填入' }, 422);
  if (!caption && !isSocial) return noText();
  if (!(await takeUserQuota(env.DB, data.user.id, 'workers_ai'))) {
    return json({ error: `今天的 AI 擷取已達 ${APIS.workers_ai.perUserDaily} 次上限，明天再試` }, 429);
  }

  if (caption) await recordUsage(env.DB, 'workers_ai');
  let { places = [], error } = caption ? await extractPlaces(env.AI, caption, await aiModel(env.DB)) : {};
  if (error === 'unavailable') return json({ error: 'AI 暫時無法使用（可能已達今日免費額度），明天再試' }, 502);
  // The text names no shop: the cover image may (a person is waiting, so the slower image read is fine).
  if (!places.some((found) => found.name) && isSocial) {
    const cover = await shopsOnCover(env, place.url);
    if (cover) {
      ({ places, error } = { places: cover.places, error: undefined });
      caption = withCoverText(caption, cover.caption);
      await saveCaption(caption);
    }
  }
  if (!caption) return noText();
  if (error === 'unusable') return json({ error: 'AI 回傳格式錯誤，請再試一次或手動填寫' }, 502);
  if (places.length === 0) return json({ error: 'AI 在貼文裡找不到店家，請手動填寫' }, 422);
  // The AI's name/address/area replace the ones Google couldn't match, unless a person wrote them.
  const replace = isUnlocated && !place.hand_edited ? [...new Set([...garbled, 'name', 'address', 'area'])] : garbled;
  const { located } = await fillFromAi(env, { ...place, caption }, places, replace, isUnlocated);
  // located false: it has a name now but Google gave no sure match, so the app asks the person to pick.
  return json({ shops: places.length, located });
}
