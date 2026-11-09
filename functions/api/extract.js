import { aiModel, extractPlaces } from '../../lib/ai.js';
import { fetchCaption, isSocialUrl, MAX_CAPTION_LENGTH } from '../../lib/social.js';
import { fetchYoutubeText } from '../../lib/youtube.js';
import { APIS, recordUsage, takeUserQuota } from '../../lib/usage.js';
import { shopsOnCover, withCoverText } from '../../lib/place-ai.js';

// Keeps one account from burning the shared daily free AI quota.
export const DAILY_EXTRACT_LIMIT = APIS.workers_ai.perUserDaily;

const json = (body, status = 200) => Response.json(body, { status });

/** POST {url, caption?}: the shops AI finds in the post (fetched from the link when no text is given). Nothing is saved. */
export async function onRequestPost({ request, env, data }) {
  if (!env.AI) return json({ error: 'AI 擷取尚未設定 Workers AI 綁定' }, 503);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'invalid json' }, 400);
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  let caption = typeof body.caption === 'string' ? body.caption.trim() : '';

  // YouTube: full description and top comments when the API is on; otherwise the page's og tags.
  if (!caption && isSocialUrl(url)) caption = ((await fetchYoutubeText(env, url)) || (await fetchCaption(url))).slice(0, MAX_CAPTION_LENGTH);
  const needCaption = () => json({ error: '抓不到貼文文字，請把貼文內容貼到「貼文文字」再試一次', needCaption: true }, 422);
  // No text at all is still worth a look at the cover image below.
  if (!caption && !isSocialUrl(url)) return needCaption();
  if (caption.length > MAX_CAPTION_LENGTH) return json({ error: `貼文文字超過 ${MAX_CAPTION_LENGTH} 字` }, 413);
  if (!(await takeUserQuota(env.DB, data.user.id, 'workers_ai'))) {
    return json({ error: `今天的 AI 擷取已達 ${DAILY_EXTRACT_LIMIT} 次上限，請手動填寫或明天再試` }, 429);
  }

  if (caption) await recordUsage(env.DB, 'workers_ai');
  let { places, error } = caption ? await extractPlaces(env.AI, caption, await aiModel(env.DB)) : { places: [] };
  if (error === 'unavailable') return json({ error: 'AI 暫時無法使用（可能已達今日免費額度），請手動填寫' }, 502);
  // The text names no shop: the cover image may (a person is waiting here, so the slower image read is fine).
  if (!places?.some((place) => place.name) && isSocialUrl(url)) {
    const cover = await shopsOnCover(env, url);
    if (cover) ({ caption, places, error } = { caption: withCoverText(caption, cover.caption), places: cover.places, error: undefined });
  }
  if (!caption) return needCaption();
  if (error === 'unusable') return json({ error: 'AI 回傳格式錯誤，請手動填寫' }, 502);
  if (places.length === 0) return json({ error: 'AI 在貼文裡找不到店家，請手動填寫' }, 422);
  return json({ caption, places });
}
