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

const MAX_DESCRIBE_LENGTH = 60;

/**
 * For a shop the post never names (「台中超美台菜餐廳，隱藏在宮原眼科裡」): its area and the post's own words,
 * minus who posted, view counts, hashtags, links and emoji. Google's text search copes with a description.
 */
export function describeQuery(place) {
  const words = String(place.caption ?? '')
    .replace(/Threads 上的.+?（@[\w.]+）/g, ' ')
    // Facebook puts a no-break space between the number and 萬, hence \s rather than a plain space.
    .replace(/[\d,.]+\s?萬?\s?次觀看\s?·\s?[\d,.]+\s?萬?\s?個心情/g, ' ')
    .replace(/https?:\/\/\S+|[#＃@]\S+|\|/g, ' ')
    .replace(/[\p{Extended_Pictographic}️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [place.area, words].filter(Boolean).join(' ').slice(0, MAX_DESCRIBE_LENGTH).trim();
}

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

/**
 * Google's star rating and review count, shown on the card and never stored (Maps terms). These fields
 * are the Enterprise SKU (about 1,000 free a month), hence a separate, tighter quota (APIS.place_rating).
 */
export async function fetchRating(key, googlePlaceId, fetchImpl) {
  const found = await call(`${PLACES_URL}/${encodeURIComponent(googlePlaceId)}`, key, 'rating,userRatingCount', {}, fetchImpl);
  return found ? { rating: found.rating ?? null, count: found.userRatingCount ?? 0 } : null;
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
      // Google dropped the place: clear it so the shop shows up under 沒定位 again.
      else await clearLocation(db, place.id);
    } catch (error) {
      console.error('Location refresh failed', error.message);
      if (error instanceof GoogleQuotaError) return;
    }
  }
}

const normalize =(text) => String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// Longest stretch of characters both names share, e.g. 「添好運」 in 「添好運港點」 and 「添好運timhowan台中」.
function longestSharedRun(a, b) {
  let longest = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let run = 0;
      while (i + run < a.length && j + run < b.length && a[i + run] === b[j + run]) run++;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}

/**
 * Loose "same shop" check for auto-locating: one name contains the other, or they share a run of at least
 * 3 characters covering half the shorter name (posts and Google often word a shop differently).
 * shortcut: two different shops sharing a word (「老王牛肉麵」「老王牛排」) can pass when the real one is not
 * among Google's hits at all; tighten with an address check if wrong pins show up.
 */
export function isSameShop(ourName, googleName) {
  const ours = [...normalize(ourName)];
  const theirs = [...normalize(googleName)];
  if (ours.length < 2 || theirs.length < 2) return false;
  if (theirs.join('').includes(ours.join('')) || ours.join('').includes(theirs.join(''))) return true;
  const shared = longestSharedRun(ours, theirs);
  return shared >= 3 && shared >= Math.min(ours.length, theirs.length) / 2;
}

const normalizeAddress = (text) => String(text ?? '')
  .replace(/[０-９]/g, (digit) => String.fromCodePoint(digit.codePointAt(0) - 0xfee0))
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
