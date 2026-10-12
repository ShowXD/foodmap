// Verifies the Cf-Access-Jwt-Assertion header that Cloudflare Access adds to every request.
// Access already blocks unauthenticated traffic at the edge; checking the JWT here means a
// misconfigured or missing Access policy can never be bypassed by spoofing headers.

const JWKS_TTL_MS = 60 * 60 * 1000;
// Unknown kids force a refetch; cap how often so junk tokens can't hammer the certs endpoint.
const MIN_FORCED_REFRESH_MS = 60 * 1000;
let jwksCache = { url: null, keys: [], fetchedAt: 0 };

const decoder = new TextDecoder();
const base64UrlToBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodeJson = (part) => JSON.parse(decoder.decode(base64UrlToBytes(part)));

export function normalizeTeamDomain(teamDomain) {
  const trimmed = String(teamDomain ?? '').trim().replace(/\/+$/, '');
  return trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
}

async function loadKeys(teamDomain, fetchImpl, now, forceRefresh) {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  const age = jwksCache.url === url ? now - jwksCache.fetchedAt : Infinity;
  if (age < (forceRefresh ? MIN_FORCED_REFRESH_MS : JWKS_TTL_MS)) return jwksCache.keys;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`certs fetch failed: ${response.status}`);
  const { keys } = await response.json();
  jwksCache = { url, keys: Array.isArray(keys) ? keys : [], fetchedAt: now };
  return jwksCache.keys;
}

/**
 * Returns the verified payload, or null when the token is missing, malformed, expired,
 * signed by an unknown key, or issued for another team/application.
 */
export async function verifyAccessJwt(token, options) {
  try {
    return await verifyOrNull(token, options);
  } catch (error) {
    // Malformed base64, bad JWK, or certs endpoint down: deny instead of throwing a 500.
    console.warn('Access JWT rejected', error.message);
    return null;
  }
}

async function verifyOrNull(token, { teamDomain, audiences, now = Date.now(), fetchImpl = fetch }) {
  if (!token || !teamDomain || audiences.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) return null;

  const issuer = normalizeTeamDomain(teamDomain);
  // Access rotates signing keys; refetch once when the kid is unknown.
  let jwk = (await loadKeys(issuer, fetchImpl, now, false)).find((key) => key.kid === header.kid);
  if (!jwk) jwk = (await loadKeys(issuer, fetchImpl, now, true)).find((key) => key.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const isSigned = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!isSigned) return null;

  const nowSeconds = Math.floor(now / 1000);
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== issuer) return null;
  if (!tokenAudiences.some((aud) => audiences.includes(aud))) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) return null;
  if (typeof payload.email !== 'string' || !payload.email) return null;
  return payload;
}

export function resetJwksCacheForTests() {
  jwksCache = { url: null, keys: [], fetchedAt: 0 };
}
