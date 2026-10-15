// What the app is showing, shared by the list, the map, 今天吃什麼 and the forms, plus the questions
// asked of it. app.js loads lists and places, map.js keeps the position, me.js the pin style.
import { readSetting } from './shared.js';

export const PIN_STYLE_KEY = 'foodmap.pinStyle';

function savedPinStyle() {
  try {
    return JSON.parse(readSetting(PIN_STYLE_KEY) ?? '{}') ?? {};
  } catch {
    return {}; // unreadable: keep the defaults
  }
}

export const state = {
  lists: [],
  currentListId: null,
  places: [],
  filter: { mode: 'all', tag: null, radius: undefined },
  search: '', // the list's search box, lower-cased
  myPosition: null,
  myAccuracy: null, // metres, as reported by the browser
  locationError: null,
  // Pin look chosen on 我的 (kept per device); colours always mean 未吃／吃過／想吃.
  pinStyle: { shape: 'pin', size: 'm', showName: false, ...savedPinStyle() },
};

export const mapsUrl = (place) => {
  const query = encodeURIComponent([place.name, place.address || place.area].filter(Boolean).join(' '));
  const placeId = place.google_place_id ? `&query_place_id=${encodeURIComponent(place.google_place_id)}` : '';
  return `https://www.google.com/maps/search/?api=1&query=${query}${placeId}`;
};
export const isLocated = (place) => place.lat != null && place.lng != null;
export const latLngOf = (place) => ({ lat: place.lat, lng: place.lng });
// LINE places may have only a link (no name) or no map position yet.
export const needsTidying = (place) => !place.name || !isLocated(place);
export const tagsOf = (place) => String(place.tags ?? '').split(/\s+/).filter(Boolean);

function distanceKm(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const a = Math.sin(radians(to.lat - from.lat) / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(radians(to.lng - from.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
export const distanceTo = (place) => (state.myPosition && isLocated(place) ? distanceKm(state.myPosition, place) : null);
export const formatDistance = (km) => (km < 1 ? `${Math.round(km * 1000)} 公尺` : `${km.toFixed(1)} 公里`);

const SEARCH_FIELDS = ['name', 'dishes', 'area', 'address', 'tags', 'note', 'caption'];
// The search box narrows the list and the map only; 今天吃什麼 and the tag menus always use the whole list.
function matchesSearch(place) {
  return !state.search || SEARCH_FIELDS.some((field) => String(place[field] ?? '').toLowerCase().includes(state.search));
}

export function matchesFilter(place) {
  const { filter } = state;
  if (!matchesSearch(place)) return false;
  if (filter.mode === 'todo' && place.my_visited_at) return false;
  if (filter.mode === 'visited' && !place.my_visited_at) return false;
  if (filter.mode === 'starred' && !place.starred) return false;
  if (filter.mode === 'untidy' && !needsTidying(place)) return false;
  if (filter.mode === 'near' && !(distanceTo(place) != null && distanceTo(place) <= filter.radius)) return false;
  if (filter.tag && !tagsOf(place).includes(filter.tag)) return false;
  return true;
}
