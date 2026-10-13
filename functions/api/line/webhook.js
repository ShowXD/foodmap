import { isSocialUrl, fetchCaption, extractPlaces } from '../extract.js';
import { isSameShop, placeQuery, saveLocation, searchPlaces } from '../../../lib/google.js';
import { recordUsage } from '../../../lib/usage.js';

const MAX_LINKS_PER_MESSAGE = 3;
// Shared with the in-app button's free Workers AI quota; past this, links are saved without AI.
export const LINE_DAILY_AI_LIMIT = 50;
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

async function usedLineAiToday(db) {
  const row = await db
    .prepare("SELECT COUNT(DISTINCT line_message_id || url) AS n FROM places WHERE source = 'line' AND date(created_at) = date('now')")
    .first();
  return row.n;
}

async function savePlace(db, listId, messageId, url, caption, place = {}) {
  const fields = { name: place.name ?? '', dishes: place.dishes ?? '', area: place.area ?? '', address: place.address ?? '', tags: place.tags ?? '' };
  const saved = await db
    .prepare(
      `INSERT INTO places (list_id, url, caption, name, dishes, area, address, tags, source, line_message_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'line', ?9
       WHERE NOT EXISTS (SELECT 1 FROM places WHERE list_id = ?1 AND url = ?2 AND COALESCE(name, '') = ?4)
       RETURNING id`,
    )
    .bind(listId, url, caption.slice(0, MAX_CAPTION_LENGTH), fields.name, fields.dishes, fields.area, fields.address, fields.tags, messageId)
    .first();
  return saved?.id ?? null;
}

// Only Google's top hit, and only when its name matches; anything doubtful stays in 待整理 for a person to pick.
async function locateAutomatically(env, placeId, place) {
  if (!env.GOOGLE_PLACES_KEY || !placeId || !place.name) return;
  try {
    await recordUsage(env.DB, 'places_search');
    const [best] = await searchPlaces(env.GOOGLE_PLACES_KEY, placeQuery(place));
    if (best && isSameShop(place.name, best.name)) await saveLocation(env.DB, placeId, best);
  } catch (error) {
    console.error('Auto-locate failed', error.message);
  }
}

async function collectLinks(env, event) {
  const groupId = event.source?.groupId ?? event.source?.roomId;
  if (!groupId) return; // 1:1 chats with the bot are ignored.
  const listId = await boundListId(env.DB, groupId);
  if (!listId) return;

  const { links, caption: messageText } = parseLinks(event.message.text);
  for (const url of links) {
    // LINE retries deliveries; skip links already saved from this message.
    const seen = await env.DB.prepare('SELECT 1 FROM places WHERE line_message_id = ? AND url = ?').bind(event.message.id, url).first();
    if (seen) continue;

    const caption = messageText || (await fetchCaption(url));
    let places = [];
    if (caption && env.AI && (await usedLineAiToday(env.DB)) < LINE_DAILY_AI_LIMIT) {
      await recordUsage(env.DB, 'workers_ai');
      ({ places = [] } = await extractPlaces(env.AI, caption));
    }
    // Never lose a link: if AI found nothing, save the bare link for manual editing.
    if (places.length === 0) await savePlace(env.DB, listId, event.message.id, url, caption);
    for (const place of places) {
      await locateAutomatically(env, await savePlace(env.DB, listId, event.message.id, url, caption, place), place);
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
