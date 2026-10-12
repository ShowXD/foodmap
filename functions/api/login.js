export const SESSION_COOKIE = 'foodmap_session';
const SESSION_DAYS = 30;
const encoder = new TextEncoder();

export function hasAuthSecrets(env) {
  return Boolean(env.FAMILY_PASSWORD && env.SESSION_SECRET);
}

// Keyed on the password too, so changing FAMILY_PASSWORD logs everyone out.
function signingKey(env) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`${env.SESSION_SECRET}\n${env.FAMILY_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

const toBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function createSessionValue(env, now = Date.now()) {
  const expiresAt = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(expiresAt));
  return `${expiresAt}.${toBase64Url(signature)}`;
}

export async function isValidSession(env, value, now = Date.now()) {
  const [expiresAt, signature] = (value ?? '').split('.');
  if (!expiresAt || !signature || !(Number(expiresAt) > now)) return false;
  try {
    // subtle.verify compares in constant time.
    return await crypto.subtle.verify('HMAC', await signingKey(env), fromBase64Url(signature), encoder.encode(expiresAt));
  } catch {
    return false;
  }
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function isCorrectPassword(env, password) {
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  const [given, expected] = await Promise.all([digest(password), digest(env.FAMILY_PASSWORD)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= given[i] ^ expected[i];
  return difference === 0;
}

const redirect = (location, headers = {}) => new Response(null, { status: 303, headers: { Location: location, ...headers } });

export async function onRequestPost({ request, env }) {
  if (!hasAuthSecrets(env)) return new Response('登入尚未設定 FAMILY_PASSWORD / SESSION_SECRET', { status: 503 });

  const form = await request.formData().catch(() => null);
  const password = form?.get('password');
  if (typeof password !== 'string' || !(await isCorrectPassword(env, password))) {
    // ponytail: fixed delay only slows guessing; add a Cloudflare rate limiting rule on /api/login if it gets abused
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return redirect('/login?error=1');
  }

  const cookie = `${SESSION_COOKIE}=${await createSessionValue(env)}; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Lax`;
  return redirect('/', { 'Set-Cookie': cookie });
}
