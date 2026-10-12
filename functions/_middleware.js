import { SESSION_COOKIE, hasAuthSecrets, isValidSession, readCookie } from './api/login.js';

// The LINE webhook can't log in; it authenticates with the x-line-signature header instead.
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/api/login', '/api/line/webhook', '/icon.svg']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const { pathname } = new URL(request.url);
  if (PUBLIC_PATHS.has(pathname)) return next();

  // Fail closed: a missing secret must never leave the site open.
  if (!hasAuthSecrets(env)) return new Response('登入尚未設定 FAMILY_PASSWORD / SESSION_SECRET', { status: 503 });
  if (await isValidSession(env, readCookie(request, SESSION_COOKIE))) return next();

  if (pathname.startsWith('/api/')) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.redirect(new URL('/login', request.url), 302);
}
