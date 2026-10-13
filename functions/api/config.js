// The browser Maps key is visible to anyone using the page anyway (it's locked to our domain and
// the Maps JavaScript API in Google Cloud); serving it here keeps it out of the public repo.
export function onRequestGet({ env }) {
  return Response.json({ mapsKey: env.GOOGLE_MAPS_BROWSER_KEY ?? null, mapId: env.GOOGLE_MAPS_MAP_ID ?? null });
}
