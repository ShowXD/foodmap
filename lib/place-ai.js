// Saving shops found in a post, filling nameless ones in with AI later, and placing them on the map.
// Used by the LINE webhook, 「AI 重新分析」 (reanalyze.js) and the background retry (places.js GET).
import { extractPlaces } from './ai.js';
import { isSameAddress, isSameShop, placeQuery, saveLocation, searchPlaces } from './google.js';
import { MAX_CAPTION_LENGTH } from './social.js';
import { APIS, dayIn, recordUsage } from './usage.js';

/** `post` is where the shop came from: { list_id, url, caption, source, line_message_id, created_by }. */
export async function savePlace(db, post, place = {}, isAiPending = false) {
  const fields = { name: place.name ?? '', dishes: place.dishes ?? '', area: place.area ?? '', address: place.address ?? '', tags: place.tags ?? '' };
  const saved = await db
    .prepare(
      `INSERT INTO places (list_id, url, caption, name, dishes, area, address, tags, source, line_message_id, ai_pending, created_by)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
       WHERE NOT EXISTS (SELECT 1 FROM places WHERE list_id = ?1 AND url = ?2 AND COALESCE(name, '') = ?4)
       RETURNING id`,
    )
    .bind(post.list_id, post.url, (post.caption ?? '').slice(0, MAX_CAPTION_LENGTH), fields.name, fields.dishes, fields.area, fields.address, fields.tags,
      post.source ?? 'line', post.line_message_id ?? null, isAiPending ? 1 : 0, post.created_by ?? null)
    .first();
  return saved?.id ?? null;
}

/**
 * Fills a saved place that has no shop name yet from the AI's shops (keeping anything already typed in),
 * saves the post's other shops next to it, and locates them. `filled` is false when someone named it
 * meanwhile; `located` says whether it also got onto the map (otherwise it stays in 待整理).
 */
export async function fillFromAi(env, row, places) {
  const [first, ...others] = places;
  if (!first) return { filled: false, located: false };
  const filled = await env.DB
    .prepare(
      `UPDATE places SET name = ?, dishes = COALESCE(NULLIF(dishes, ''), ?), area = COALESCE(NULLIF(area, ''), ?),
              address = COALESCE(NULLIF(address, ''), ?), tags = COALESCE(NULLIF(tags, ''), ?), ai_pending = 0
       WHERE id = ? AND COALESCE(name, '') = '' RETURNING *`,
    )
    .bind(first.name, first.dishes, first.area, first.address, first.tags, row.id)
    .first();
  if (!filled) return { filled: false, located: false };
  const located = await locateAutomatically(env, filled.id, filled);
  for (const place of others) await locateAutomatically(env, await savePlace(env.DB, filled, place), place);
  return { filled: true, located };
}

// Below this many AI calls today (UTC, all uses together), links skipped earlier are analysed in the
// background; the rest of the free ~140 stays for people's own 「AI 自動填入」.
export const RETRY_AI_BELOW = APIS.workers_ai.dailyLimit - 40;
const RETRIES_PER_OPEN = 5;

/** Analyses a few of this list's pending LINE links. Runs when someone opens the list (places.js GET). */
export async function retryPendingAi(env, listId, now = new Date()) {
  if (!env.AI) return;
  const usage = await env.DB.prepare("SELECT count FROM api_usage WHERE api = 'workers_ai' AND day = ?").bind(dayIn('UTC', now)).first();
  const room = Math.min(RETRIES_PER_OPEN, RETRY_AI_BELOW - (usage?.count ?? 0));
  if (room <= 0) return;
  // Claimed up front so two people opening the list at once don't analyse the same link twice.
  const { results: claimed } = await env.DB
    .prepare(
      `UPDATE places SET ai_pending = 0
       WHERE id IN (SELECT id FROM places WHERE list_id = ? AND ai_pending = 1 ORDER BY id LIMIT ?)
       RETURNING id, caption`,
    )
    .bind(listId, room)
    .all();
  const putBack = (ids) => Promise.all(ids.map((id) => env.DB.prepare('UPDATE places SET ai_pending = 1 WHERE id = ?').bind(id).run()));
  for (const [index, row] of claimed.entries()) {
    try {
      await recordUsage(env.DB, 'workers_ai', now);
      const { places = [], error } = await extractPlaces(env.AI, row.caption ?? '');
      if (error === 'unavailable') return await putBack(claimed.slice(index).map((rest) => rest.id)); // e.g. Cloudflare's daily limit
      await fillFromAi(env, row, places);
    } catch (error) {
      // Put this and the rest of the claimed links back so a later open tries them again.
      await putBack(claimed.slice(index).map((rest) => rest.id));
      throw error;
    }
  }
}

// Only Google's top hit, and only when its name or street address matches the post's; anything doubtful
// stays in 待整理 for a person to pick.
/** True when the place was put on the map. */
export async function locateAutomatically(env, placeId, place) {
  if (!env.GOOGLE_PLACES_KEY || !placeId || !(place.name || place.address)) return false;
  try {
    await recordUsage(env.DB, 'places_search');
    const [best] = await searchPlaces(env.GOOGLE_PLACES_KEY, placeQuery(place));
    if (!best || !(isSameShop(place.name, best.name) || isSameAddress(place.address, best.address))) return false;
    await saveLocation(env.DB, placeId, best);
    return true;
  } catch (error) {
    console.error('Auto-locate failed', error.message);
    return false;
  }
}
