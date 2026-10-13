// The browser Maps key is visible to anyone using the page anyway (it's locked to our domain and
// the Maps JavaScript API in Google Cloud); serving it here keeps it out of the public repo.
import { APIS, recordUsage, takeUserQuota } from '../../lib/usage.js';

// The page asks for this right before creating the map, so each call is one billed map load.
// Past the per-person limit no key is handed out, so no map (and no charge) happens.
export async function onRequestGet({ env, data }) {
  if (!env.GOOGLE_MAPS_BROWSER_KEY) return Response.json({ mapsKey: null, mapId: null });
  if (!(await takeUserQuota(env.DB, data.user.id, 'maps_load'))) {
    return Response.json({ mapsKey: null, mapId: null, error: `今天開地圖的次數已用完（每人每天 ${APIS.maps_load.perUserDaily} 次），明天再來` });
  }
  await recordUsage(env.DB, 'maps_load');
  return Response.json({ mapsKey: env.GOOGLE_MAPS_BROWSER_KEY, mapId: env.GOOGLE_MAPS_MAP_ID ?? null });
}
