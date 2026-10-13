// The browser Maps key is visible to anyone using the page anyway (it's locked to our domain and
// the Maps JavaScript API in Google Cloud); serving it here keeps it out of the public repo.
import { recordUsage } from '../../lib/usage.js';

// The page asks for this right before creating the map, so each call is one billed map load.
export async function onRequestGet({ env }) {
  if (env.GOOGLE_MAPS_BROWSER_KEY) await recordUsage(env.DB, 'maps_load');
  return Response.json({ mapsKey: env.GOOGLE_MAPS_BROWSER_KEY ?? null, mapId: env.GOOGLE_MAPS_MAP_ID ?? null });
}
