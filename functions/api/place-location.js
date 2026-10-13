import { findAccessiblePlace } from '../../lib/lists.js';
import { clearLocation, saveLocation } from '../../lib/google.js';

const GOOGLE_PLACE_ID = /^[\w-]{10,300}$/;
const json = (body, status = 200) => Response.json(body, { status });

const isCoordinate = (number, limit) => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= limit;

/**
 * PUT {place_id, lat, lng, google_place_id?}: with a Google place ID the position came from a
 * search pick and expires per Google's terms; without one it was placed by hand and is kept.
 */
export async function onRequestPut({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const place = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!place) return json({ error: 'not found' }, 404);
  if (!isCoordinate(body.lat, 90) || !isCoordinate(body.lng, 180)) return json({ error: 'invalid lat/lng' }, 400);
  const googlePlaceId = body.google_place_id ?? null;
  if (googlePlaceId !== null && !GOOGLE_PLACE_ID.test(googlePlaceId)) return json({ error: 'invalid google_place_id' }, 400);

  await saveLocation(env.DB, place.id, { lat: body.lat, lng: body.lng, google_place_id: googlePlaceId });
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const place = await findAccessiblePlace(env.DB, data.user, body?.place_id);
  if (!place) return json({ error: 'not found' }, 404);
  await clearLocation(env.DB, place.id);
  return json({ ok: true });
}
