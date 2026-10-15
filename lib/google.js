import { recordUsage } from './usage.js';

// Places API (New). Field masks are kept to the cheapest SKU that has what we need:
// Text Search with id/name/address/location = Text Search Pro; Details with only location = Essentials.
const PLACES_URL = 'https://places.googleapis.com/v1/places';
const SEARCH_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location';
const MAX_CANDIDATES = 3;

export class GoogleQuotaError extends Error {}

async function call(url, key, fieldMask, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
  });
  if (response.status === 429) throw new GoogleQuotaError('Google quota reached');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
  return response.json();
}

/** What we type into Google: the shop name plus whatever narrows it down. */
export const placeQuery = (place) => [place.name, place.address || place.area].filter(Boolean).join(' ').trim();

export async function searchPlaces(key, textQuery, fetchImpl) {
  const body = JSON.stringify({ textQuery, pageSize: MAX_CANDIDATES, languageCode: 'zh-TW', regionCode: 'tw' });
  const found = await call(`${PLACES_URL}:searchText`, key, SEARCH_FIELDS, { method: 'POST', body }, fetchImpl);
  return (found?.places ?? []).slice(0, MAX_CANDIDATES).map((place) => ({
    google_place_id: place.id,
    name: place.displayName?.text ?? '',
    address: place.formattedAddress ?? '',
    lat: place.location?.latitude,
    lng: place.location?.longitude,
  }));
}

/** Current coordinates for a stored place ID; null when Google no longer knows the place. */
export async function fetchLocation(key, googlePlaceId, fetchImpl) {
  const found = await call(`${PLACES_URL}/${encodeURIComponent(googlePlaceId)}`, key, 'location', {}, fetchImpl);
  return found?.location ? { lat: found.location.latitude, lng: found.location.longitude } : null;
}

// Google-sourced lat/lng may be cached for at most 30 days (Maps Service Terms 14.3).
const REFRESH_AFTER = '-25 days';
const EXPIRE_AFTER = '-30 days';
const MAX_REFRESH_PER_REQUEST = 5;

/** A google_place_id means the position came from Google (expires); none means placed by hand (kept). */
export async function saveLocation(db, placeId, { lat, lng, google_place_id: googlePlaceId = null }) {
  await db
    .prepare(
      `UPDATE places SET lat = ?2, lng = ?3, google_place_id = ?4,
              location_source = CASE WHEN ?4 IS NULL THEN 'manual' ELSE 'google' END,
              location_fetched_at = CASE WHEN ?4 IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
       WHERE id = ?1`,
    )
    .bind(placeId, lat, lng, googlePlaceId)
    .run();
}

export async function clearLocation(db, placeId) {
  await db
    .prepare('UPDATE places SET google_place_id = NULL, lat = NULL, lng = NULL, location_source = NULL, location_fetched_at = NULL WHERE id = ?')
    .bind(placeId)
    .run();
}

/** Drops Google coordinates older than 30 days; the place ID stays so they can be fetched again. */
export async function expireGoogleLocations(db, listId) {
  await db
    .prepare(
      `UPDATE places SET lat = NULL, lng = NULL
       WHERE list_id = ? AND location_source = 'google' AND location_fetched_at < datetime('now', '${EXPIRE_AFTER}')`,
    )
    .bind(listId)
    .run();
}

// ponytail: refreshed only when someone opens the list (Pages has no cron); expireGoogleLocations keeps us within the terms meanwhile
export async function refreshStaleLocations(db, key, listId, fetchImpl) {
  const { results } = await db
    .prepare(
      `SELECT id, google_place_id FROM places
       WHERE list_id = ? AND location_source = 'google' AND location_fetched_at < datetime('now', '${REFRESH_AFTER}')
       LIMIT ${MAX_REFRESH_PER_REQUEST}`,
    )
    .bind(listId)
    .all();
  for (const place of results) {
    try {
      await recordUsage(db, 'place_details');
      const location = await fetchLocation(key, place.google_place_id, fetchImpl);
      if (location) await saveLocation(db, place.id, { ...location, google_place_id: place.google_place_id });
      // Google dropped the place: clear it so the shop shows up under 待整理 again.
      else await clearLocation(db, place.id);
    } catch (error) {
      console.error('Location refresh failed', error.message);
      if (error instanceof GoogleQuotaError) return;
    }
  }
}

const normalize =(text) => String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** Loose "same shop" check for auto-locating LINE places: one name contains the other. */
export function isSameShop(ourName, googleName) {
  const ours = normalize(ourName);
  const theirs = normalize(googleName);
  return ours.length >= 2 && theirs.length >= 2 && (theirs.includes(ours) || ours.includes(theirs));
}

const normalizeAddress = (text) => String(text ?? '')
  .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  .replaceAll('臺', '台')
  .replace(/\s/g, '');

/**
 * Same street and door number (「華美街204號」 in 「403台灣台中市西區華美街204號」), for shops whose name
 * the post writes differently from Google. ponytail: ignores the city, trusting the search query
 * (which includes the post's address) to have found the right one.
 */
// Road name (bounded, so a long string can't make the lazy match backtrack for ages), section, lane, alley, number.
const STREET_AND_NUMBER = /[^市縣區鄉鎮]{1,20}?(?:路|街|大道)(?:[\d一二三四五六七八九十]+段)?(?:\d+巷)?(?:\d+弄)?\d+(?:之\d+)?號/;

export function isSameAddress(ourAddress, googleAddress) {
  const street = STREET_AND_NUMBER.exec(normalizeAddress(ourAddress))?.[0];
  return Boolean(street) && normalizeAddress(googleAddress).includes(street);
}
