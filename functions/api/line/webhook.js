import { extractPlaces } from '../../../lib/ai.js';
import { locateAutomatically, savePlace } from '../../../lib/place-ai.js';
import { fetchCaption, isSocialUrl } from '../../../lib/social.js';
import { recordUsage } from '../../../lib/usage.js';

const MAX_LINKS_PER_MESSAGE = 3;
// Shared with the in-app button's free Workers AI quota; past this, links are saved without AI.
export const LINE_DAILY_AI_LIMIT = 50;
export const LINE_LIST_DAILY_AI_LIMIT = 20;

const encoder = new TextEncoder();

/** LINE signs the raw body with HMAC-SHA256(channel secret), base64 in x-line-signature. */
export async function isValidLineSignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  let signatureBytes;
  try {
    signatureBytes = Uint8Array.from(atob(signature), (c) => c.codePointAt(0));
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
