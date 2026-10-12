import { verifyAccessJwt } from '../lib/access.js';
import { ensureUser } from '../lib/users.js';

// The LINE webhook can't log in; it authenticates with the x-line-signature header instead.
const PUBLIC_PATHS = new Set(['/api/line/webhook']);
// Disabled users can only see the notice page and their own status.
const WAITING_PATHS = new Set(['/pending', '/pending.html', '/pending.js', '/api/me', '/icon.svg']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// No inline scripts anywhere, so script-src can stay 'self'; frame-ancestors blocks clickjacking.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

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

// Blocks cross-site form/fetch submissions riding on the Access cookie (CSRF).
export function isCrossSiteWrite(request) {
  if (SAFE_METHODS.has(request.method)) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin') return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin !== new URL(request.url).origin;
}

function withSecurityHeaders(response, pathname) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  if (pathname.startsWith('/api/')) secured.headers.set('Cache-Control', 'no-store');
  return secured;
}

async function handle(context, pathname) {
  const { request, env, next, data } = context;
  if (PUBLIC_PATHS.has(pathname)) return next();
  if (isCrossSiteWrite(request)) return Response.json({ error: 'cross-site request blocked' }, { status: 403 });

  const isLocalDev = LOCAL_HOSTS.has(new URL(request.url).hostname) && env.DEV_USER_EMAIL;
  // Fail closed: missing Access settings must never leave the site open.
  if (!isLocalDev && (!env.ACCESS_TEAM_DOMAIN || audiences(env).length === 0)) {
    return new Response('登入尚未設定', { status: 503 });
  }

  const email = await authenticatedEmail(request, env);
  if (!email) return new Response('需要透過 Cloudflare Access 登入', { status: 401 });

  const user = await ensureUser(env.DB, email, env);
  data.user = user;
  if (user.status === 'approved' || WAITING_PATHS.has(pathname)) return next();

  if (pathname.startsWith('/api/')) return Response.json({ error: 'account disabled', status: user.status }, { status: 403 });
  return Response.redirect(new URL('/pending', request.url), 302);
}

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  return withSecurityHeaders(await handle(context, pathname), pathname);
}
