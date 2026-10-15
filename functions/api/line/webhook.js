import { isSocialUrl, fetchCaption, extractPlaces } from '../extract.js';
import { isSameAddress, isSameShop, placeQuery, saveLocation, searchPlaces } from '../../../lib/google.js';
import { APIS, dayIn, recordUsage } from '../../../lib/usage.js';

const MAX_LINKS_PER_MESSAGE = 3;
// Shared with the in-app button's free Workers AI quota; past this, links are saved without AI.
export const LINE_DAILY_AI_LIMIT = 50;
export const LINE_LIST_DAILY_AI_LIMIT = 20;
const MAX_CAPTION_LENGTH = 5000;

const encoder = new TextEncoder();

/** LINE signs the raw body with HMAC-SHA256(channel secret), base64 in x-line-signature. */
export async function isValidLineSignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  let signatureBytes;
  try {
    signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(rawBody));
}

/** IG/FB links in a chat message (max 3), plus the remaining text to use as a caption. */
export function parseLinks(text) {
  const urls = [...new Set(String(text ?? '').match(/https?:\/\/[^\s<>"]+/g) ?? [])];
  const links = urls.filter(isSocialUrl).slice(0, MAX_LINKS_PER_MESSAGE);
  const caption = urls.reduce((rest, url) => rest.replaceAll(url, ' '), String(text ?? '')).replace(/\s+/g, ' ').trim();
  return { links, caption };
}

async function boundListId(db, groupId) {
  // Remember every group the bot sees so the admin can bind it later; only bound groups are collected.
  const row = await db
    .prepare(
      `INSERT INTO line_groups (group_id, last_message_at) VALUES (?1, CURRENT_TIMESTAMP)
       ON CONFLICT (group_id) DO UPDATE SET last_message_at = CURRENT_TIMESTAMP RETURNING list_id`,
    )
    .bind(groupId)
    .first();
  return row?.list_id ?? null;
}

// LINE links have no signed-in person to count against, so the limit is per list (one friend group
// can't use up everyone's AI) on top of the site-wide one.
async function canUseLineAi(db, listId) {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT line_message_id || url) AS total,
              COUNT(DISTINCT CASE WHEN list_id = ? THEN line_message_id || url END) AS this_list
       FROM places WHERE source = 'line' AND date(created_at) = date('now')`,
    )
    .bind(listId)
    .first();
  return row.total < LINE_DAILY_AI_LIMIT && row.this_list < LINE_LIST_DAILY_AI_LIMIT;
}

/** `post` is where the shop came from: { list_id, url, caption, source, line_message_id, created_by }. */
async function savePlace(db, post, place = {}, isAiPending = false) {
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
 * saves the post's other shops next to it, and locates them. False when someone named it meanwhile.
 * Shared by the background retry and the in-app 「AI 重新分析」 (reanalyze.js).
 */
export async function fillFromAi(env, row, places) {
  const [first, ...others] = places;
  if (!first) return false;
  const filled = await env.DB
    .prepare(
      `UPDATE places SET name = ?, dishes = COALESCE(NULLIF(dishes, ''), ?), area = COALESCE(NULLIF(area, ''), ?),
              address = COALESCE(NULLIF(address, ''), ?), tags = COALESCE(NULLIF(tags, ''), ?), ai_pending = 0
       WHERE id = ? AND COALESCE(name, '') = '' RETURNING *`,
    )
    .bind(first.name, first.dishes, first.area, first.address, first.tags, row.id)
    .first();
  if (!filled) return false;
  await locateAutomatically(env, filled.id, filled);
  for (const place of others) await locateAutomatically(env, await savePlace(env.DB, filled, place), place);
  return true;
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
async function locateAutomatically(env, placeId, place) {
  if (!env.GOOGLE_PLACES_KEY || !placeId || !(place.name || place.address)) return;
  try {
    await recordUsage(env.DB, 'places_search');
    const [best] = await searchPlaces(env.GOOGLE_PLACES_KEY, placeQuery(place));
    if (best && (isSameShop(place.name, best.name) || isSameAddress(place.address, best.address))) await saveLocation(env.DB, placeId, best);
  } catch (error) {
    console.error('Auto-locate failed', error.message);
  }
}

const BIND_COMMAND = /^綁定\s*([A-Za-z0-9]{6})$/;

// A group owner's one-time code (line-bind-code.js) binds this LINE group to their list. It never takes
// over a LINE group that already feeds a list; that one has to be unbound first by its owner or a site admin.
async function bindWithCode(db, groupId, code) {
  const valid = await db
    .prepare('SELECT list_id FROM line_bind_codes WHERE code = ? AND expires_at > CURRENT_TIMESTAMP')
    .bind(code)
    .first();
  if (!valid) return;
  const bound = await db
    .prepare(
      `INSERT INTO line_groups (group_id, list_id, last_message_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
       ON CONFLICT (group_id) DO UPDATE SET list_id = ?2, last_message_at = CURRENT_TIMESTAMP WHERE line_groups.list_id IS NULL
       RETURNING list_id`,
    )
    .bind(groupId, valid.list_id)
    .first();
  if (bound) await db.prepare('DELETE FROM line_bind_codes WHERE code = ?').bind(code).run();
}

async function collectLinks(env, event) {
  const groupId = event.source?.groupId ?? event.source?.roomId;
  if (!groupId) return; // 1:1 chats with the bot are ignored.
  const bindCommand = BIND_COMMAND.exec(String(event.message.text ?? '').trim());
  if (bindCommand) {
    await bindWithCode(env.DB, groupId, bindCommand[1].toUpperCase());
    return;
  }
  const listId = await boundListId(env.DB, groupId);
  if (!listId) return;

  const { links, caption: messageText } = parseLinks(event.message.text);
  for (const url of links) {
    // LINE retries deliveries; skip links already saved from this message.
    const seen = await env.DB.prepare('SELECT 1 FROM places WHERE line_message_id = ? AND url = ?').bind(event.message.id, url).first();
    if (seen) continue;

    const caption = messageText || (await fetchCaption(url));
    let places = [];
    let isAiPending = false;
    if (caption && env.AI) {
      if (await canUseLineAi(env.DB, listId)) {
        await recordUsage(env.DB, 'workers_ai');
        const extracted = await extractPlaces(env.AI, caption);
        places = extracted.places ?? [];
        isAiPending = extracted.error === 'unavailable';
      } else {
        isAiPending = true;
      }
    }
    // Never lose a link: if AI found nothing, save the bare link for manual editing (or a later retry).
    const post = { list_id: listId, url, caption, source: 'line', line_message_id: event.message.id };
    if (places.length === 0) await savePlace(env.DB, post, {}, isAiPending);
    for (const place of places) {
      await locateAutomatically(env, await savePlace(env.DB, post, place), place);
    }
  }
}

export async function handleEvent(env, event) {
  if (event.type === 'join' && event.source?.groupId) {
    await env.DB.prepare('INSERT INTO line_groups (group_id) VALUES (?) ON CONFLICT DO NOTHING').bind(event.source.groupId).run();
  } else if (event.type === 'message' && event.message?.type === 'text') {
    await collectLinks(env, event);
  } else if (event.type === 'unsend' && event.unsend?.messageId) {
    // The sender took the message back, so drop what we saved from it.
    await env.DB.prepare('DELETE FROM places WHERE line_message_id = ?').bind(event.unsend.messageId).run();
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.LINE_CHANNEL_SECRET) return new Response('LINE webhook not configured', { status: 503 });
  const rawBody = await request.text();
  if (!(await isValidLineSignature(env.LINE_CHANNEL_SECRET, rawBody, request.headers.get('x-line-signature')))) {
    return new Response('invalid signature', { status: 401 });
  }

  let events;
  try {
    ({ events = [] } = JSON.parse(rawBody));
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  // Answer LINE right away; AI extraction can take seconds, so it runs after the response.
  // Events run one by one so places keep chat order and AI calls don't pile up.
  waitUntil(
    (async () => {
      for (const event of events) {
        await handleEvent(env, event).catch((error) => console.error('LINE event failed', event.type, error.message));
      }
    })(),
  );
  return new Response('ok');
}
