import { findUserByEmail } from './users.js';

// Linking another sign-in to an account: the signed-in person starts a link (an HttpOnly cookie holding a
// one-time token), signs out, and signs in with the other account. That second sign-in proves they own it;
// the middleware then attaches its email to the first account.
export const LINK_COOKIE = 'foodmap_link';
export const LINK_RESULT_COOKIE = 'foodmap_link_result';
const VALID_MINUTES = 10;

const toHex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
/** 64 hex characters (256 random bits). */
export const randomToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
export const hashToken = async (token) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

export function readCookie(request, name) {
  const cookies = request.headers.get('Cookie') ?? '';
  const match = cookies.split(/;\s*/).find((pair) => pair.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null; // a malformed cookie (e.g. "%") must not turn every request into a 500
  }
}

/** Starts a link for this account; returns the Set-Cookie value to hand to the browser. */
export async function startLink(db, userId) {
  const token = randomToken();
  await db.prepare('DELETE FROM link_requests WHERE user_id = ? OR expires_at < CURRENT_TIMESTAMP').bind(userId).run();
  await db
    .prepare(`INSERT INTO link_requests (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${VALID_MINUTES} minutes'))`)
    .bind(await hashToken(token), userId)
    .run();
  return `${LINK_COOKIE}=${token}; Path=/; Max-Age=${VALID_MINUTES * 60}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Called on each request that carries the link cookie. Returns null while the person is still signed in
 * as the account that started the link; otherwise the outcome:
 * 'linked' | 'taken' (that email already has its own account) | 'expired'.
 */
export async function completeLink(db, email, token) {
  const tokenHash = await hashToken(token);
  const pending = await db
    .prepare('SELECT user_id FROM link_requests WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP')
    .bind(tokenHash)
    .first();
  if (!pending) return 'expired';
  const existing = await findUserByEmail(db, email);
  if (existing?.id === pending.user_id) return null;

  // Claiming the request first makes it single-use even if two requests arrive at once.
  const claimed = await db.prepare('DELETE FROM link_requests WHERE token_hash = ? RETURNING user_id').bind(tokenHash).first();
  if (!claimed) return null;
  if (existing) return 'taken';
  await db.prepare('INSERT INTO user_identities (email, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(email, claimed.user_id).run();
  return 'linked';
}

export const clearLinkCookie = () => `${LINK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
// Readable by the page so it can tell the person what happened, then it deletes it.
export const linkResultCookie = (outcome) => `${LINK_RESULT_COOKIE}=${outcome}; Path=/; Max-Age=120; Secure; SameSite=Lax`;
