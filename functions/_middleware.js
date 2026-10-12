import { verifyAccessJwt } from '../lib/access.js';
import { ensureUser } from '../lib/users.js';

// The LINE webhook can't log in; it authenticates with the x-line-signature header instead.
const PUBLIC_PATHS = new Set(['/api/line/webhook']);
// Disabled users can only see the notice page and their own status.
const WAITING_PATHS = new Set(['/pending', '/pending.html', '/api/me', '/icon.svg']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const audiences = (env) => String(env.ACCESS_AUD ?? '').split(',').map((aud) => aud.trim()).filter(Boolean);

export async function authenticatedEmail(request, env) {
  const { hostname } = new URL(request.url);
  // DEV_USER_EMAIL only works on localhost, so setting it by mistake in production opens nothing.
  if (LOCAL_HOSTS.has(hostname) && env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL.trim().toLowerCase();

  const payload = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audiences: audiences(env),
  });
  return payload ? payload.email.trim().toLowerCase() : null;
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const { pathname } = new URL(request.url);
  if (PUBLIC_PATHS.has(pathname)) return next();

  const isLocalDev = LOCAL_HOSTS.has(new URL(request.url).hostname) && env.DEV_USER_EMAIL;
  // Fail closed: missing Access settings must never leave the site open.
  if (!isLocalDev && (!env.ACCESS_TEAM_DOMAIN || audiences(env).length === 0)) {
    return new Response('登入尚未設定 ACCESS_TEAM_DOMAIN / ACCESS_AUD', { status: 503 });
  }

  const email = await authenticatedEmail(request, env);
  if (!email) return new Response('需要透過 Cloudflare Access 登入', { status: 401 });

  const user = await ensureUser(env.DB, email, env);
  data.user = user;
  if (user.status !== 'disabled' || WAITING_PATHS.has(pathname)) return next();

  if (pathname.startsWith('/api/')) return Response.json({ error: 'account disabled', status: user.status }, { status: 403 });
  return Response.redirect(new URL('/pending', request.url), 302);
}
