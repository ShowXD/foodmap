// The Google map: shop pins, my position, the 幾公里內 range, placing a pin by hand and finding a shop on Google.
import { $, api, openDialog } from './shared.js';
import { formatDistance, isLocated, latLngOf, matchesFilter, state } from './state.js';

const TAIWAN = { lat: 23.7, lng: 120.96 };

// What the map needs from the page around it; app.js hands these over once with connectMap.
let page = null;
export function connectMap(handlers) {
  page = handlers;
}

let mapReady = null;
let map = null;
let markerLibrary = null;
let markers = [];
let myMarker = null;
let hasFittedMap = false;
let draggingPlace = null;
let dragMarker = null;

function showMapFallback(error) {
  console.error('Map unavailable', error);
  // Google can reject the key after the map was made (wrong domain, quota used up); its pins then throw,
  // which would also stop the list from drawing, so the map is dropped altogether.
  map = null;
  markers = [];
  $('map').hidden = true;
  $('map-fallback').hidden = false;
  $('map-fallback-text').textContent = `地圖無法使用（${error.message}），清單、定位與今天吃什麼仍可使用。`;
}

// Google calls this global when the key is rejected (wrong domain, API not enabled, quota used up).
window.gm_authFailure = () => showMapFallback(new Error('Google 地圖金鑰無法使用'));

function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    window.foodmapMapsReady = resolve;
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', language: 'zh-TW', region: 'TW', callback: 'foodmapMapsReady' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.onerror = () => reject(new Error('Google 地圖載入失敗'));
    document.head.append(script);
  });
}

// Every map created is a billed map load, so it is made once, when someone first opens the map.
export function ensureMap() {
  if (!mapReady) {
    mapReady = initMap();
    mapReady.catch(showMapFallback);
  }
  return mapReady;
}

async function initMap() {
  const config = await api('GET', null, '', '/api/config');
  if (!config.mapsKey || !config.mapId) throw new Error(config.error || '地圖尚未設定');
  await loadGoogleMaps(config.mapsKey);
  const [{ Map: GoogleMap }, library] = await Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('marker')]);
  markerLibrary = library;
  $('map').hidden = false;
  $('map-fallback').hidden = true;
  map = new GoogleMap($('map'), {
    center: TAIWAN,
    zoom: 7,
    mapId: config.mapId,
    gestureHandling: 'greedy', // one finger pans, which is what phone users expect
    disableDefaultUI: true,
    clickableIcons: false,
  });
  map.addListener('click', (event) => {
    if (dragMarker) dragMarker.position = event.latLng;
    else page.hideCard();
  });
  showMyPosition(true);
  renderMarkers();
}

const PIN_COLORS = { starred: ['#f59f00', '#b37400'], visited: ['#adb5bd', '#868e96'], todo: ['#d9480f', '#a8380b'] };

const PIN_SCALES = { s: 0.8, m: 1, l: 1.3 };
function pinFor(place) {
  const [background, borderColor] = PIN_COLORS[place.starred ? 'starred' : place.my_visited_at ? 'visited' : 'todo'];
  const scale = PIN_SCALES[state.pinStyle.size] ?? 1;
  let pin;
  if (state.pinStyle.shape === 'pin') {
    pin = new markerLibrary.PinElement({ background, borderColor, glyphColor: '#fff', scale });
  } else {
    pin = document.createElement('div');
    pin.className = `map-marker ${state.pinStyle.shape === 'food' ? 'food' : 'dot'}`;
    pin.style.setProperty('--marker-color', background);
    pin.style.setProperty('--marker-border', borderColor);
    pin.style.setProperty('--marker-scale', String(scale));
    if (state.pinStyle.shape === 'food') pin.textContent = '🍜';
  }
  if (!state.pinStyle.showName || !place.name) return pin;
  // The marker is anchored at its bottom centre, so the name goes above the pin to keep the tip on the spot.
  const labelled = document.createElement('div');
  labelled.className = 'marker-with-name';
  const name = document.createElement('span');
  name.className = 'marker-name';
  name.textContent = place.name;
  labelled.append(name, pin);
  return labelled;
}

export function renderMarkers() {
  if (!map) return;
  for (const marker of markers) marker.map = null;
  const shown = state.places.filter((place) => isLocated(place) && matchesFilter(place) && place.id !== draggingPlace?.id);
  // The map opens on the person's own position (showMyPosition); framing all the shops is the fallback
  // only when that position won't come (denied or unsupported). After that the map stays where they moved it.
  // Done before drawing markers so the view is right even if drawing one fails.
  if (!hasFittedMap && shown.length && (state.locationError || !navigator.geolocation)) {
    hasFittedMap = true;
    fitToPlaces(shown);
  }
  renderRadius();
  markers = shown.map((place) => {
    const marker = new markerLibrary.AdvancedMarkerElement({ map, position: latLngOf(place), title: place.name || '', content: pinFor(place), gmpClickable: true });
    marker.addEventListener('gmp-click', () => page.showCard(place));
    return marker;
  });
}

// The 幾公里內 filter draws its range around the person's position.
let radiusCircle = null;
function renderRadius() {
  if (!map || !state.myPosition || state.filter.mode !== 'near') {
    radiusCircle?.setMap(null);
    return;
  }
  radiusCircle ??= new google.maps.Circle({
    clickable: false, strokeColor: '#d9480f', strokeOpacity: 0.7, strokeWeight: 2, fillColor: '#d9480f', fillOpacity: 0.08,
  });
  radiusCircle.setOptions({ map, center: state.myPosition, radius: state.filter.radius * 1000 });
}

function fitToPlaces(shown) {
  if (shown.length === 1) {
    map.setCenter(latLngOf(shown[0]));
    map.setZoom(15);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  for (const place of shown) bounds.extend(latLngOf(place));
  map.fitBounds(bounds, 48);
}

$('fit-all').addEventListener('click', () => {
  const shown = state.places.filter((place) => isLocated(place) && matchesFilter(place));
  if (map && shown.length) fitToPlaces(shown);
});

export function watchMyPosition() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (position) => {
      const isFirstFix = !state.myPosition;
      state.myPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.myAccuracy = position.coords.accuracy;
      showMyPosition(isFirstFix);
      if (isFirstFix) page.onFirstPosition(); // distances and the 附近 chip appear
    },
    (error) => {
      state.locationError = error;
      console.warn('Location unavailable', error.message);
      if (map && !hasFittedMap) renderMarkers(); // no position coming: show all the shops instead
    },
    // maximumAge 0: a cached fix can be a coarse network guess from elsewhere.
    { enableHighAccuracy: true, maximumAge: 0 },
  );
}

let accuracyCircle = null;
// The fix the map was auto-centred on; later, sharper fixes re-centre only while the map hasn't been moved since.
let centeredOn = null;

// Runs on every location fix and once the map is ready, whichever comes last draws the dot.
function showMyPosition(shouldCenter) {
  if (!map || !state.myPosition) return;
  accuracyCircle ??= new google.maps.Circle({ map, clickable: false, strokeWeight: 0, fillColor: '#1a73e8', fillOpacity: 0.12 });
  accuracyCircle.setOptions({ center: state.myPosition, radius: state.myAccuracy ?? 0 });
  if (myMarker) {
    myMarker.position = state.myPosition;
    renderRadius();
    const center = map.getCenter();
    const isUntouched = centeredOn && center
      && Math.abs(center.lat() - centeredOn.lat) < 1e-6 && Math.abs(center.lng() - centeredOn.lng) < 1e-6;
    if (isUntouched && state.myAccuracy < centeredOn.accuracy / 2) centerOnMe();
    return;
  }
  const dot = document.createElement('div');
  dot.className = 'my-dot';
  myMarker = new markerLibrary.AdvancedMarkerElement({ map, position: state.myPosition, content: dot, title: '我的位置', zIndex: 1000 });
  if (shouldCenter) {
    centerOnMe();
    map.setZoom(15);
    hasFittedMap = true;
  }
}

function centerOnMe() {
  map.setCenter(state.myPosition);
  const center = map.getCenter();
  centeredOn = { lat: center.lat(), lng: center.lng(), accuracy: state.myAccuracy ?? Infinity };
}

$('locate-me').addEventListener('click', () => {
  if (!state.myPosition) {
    alert(state.locationError?.code === 1
      ? '沒有定位權限。請到瀏覽器或手機設定，允許這個網站使用位置'
      : '還在取得你的位置，請稍候再按一次');
    return;
  }
  if (!map) return;
  map.panTo(state.myPosition);
  map.setZoom(Math.max(map.getZoom(), 15));
  // Android lets people grant only "approximate" location, which is off by a kilometre or more.
  if (state.myAccuracy > 500) {
    alert(`目前只取得大概位置（誤差約 ${formatDistance(state.myAccuracy / 1000)}）。請到手機的「設定 → 位置 → 應用程式位置權限 → Chrome」開啟「使用精確位置」，並確認 GPS 已開啟`);
  }
});

// ---- Fixing a position by dragging ----
async function startDrag(place) {
  if (dragMarker) endDrag(); // a second drag replaces the first instead of leaving its marker behind
  page.openMapView();
  try {
    await ensureMap();
    if (!map) throw new Error('map unavailable');
  } catch {
    alert('地圖無法使用，沒辦法放標點');
    return;
  }
  page.hideCard();
  draggingPlace = place;
  const position = isLocated(place) ? latLngOf(place) : state.myPosition ?? map.getCenter().toJSON();
  dragMarker = new markerLibrary.AdvancedMarkerElement({ map, position, gmpDraggable: true, title: place.name || '', content: pinFor(place) });
  map.panTo(position);
  map.setZoom(Math.max(map.getZoom(), 17));
  $('drag-bar').hidden = false;
  renderMarkers();
}

function endDrag() {
  const place = draggingPlace;
  dragMarker.map = null;
  dragMarker = null;
  draggingPlace = null;
  $('drag-bar').hidden = true;
  return place;
}

$('drag-save').addEventListener('click', async () => {
  const position = dragMarker.position;
  // The marker reports a LatLng after dragging but the literal it was given before.
  const lat = typeof position.lat === 'function' ? position.lat() : position.lat;
  const lng = typeof position.lng === 'function' ? position.lng() : position.lng;
  const place = endDrag();
  try {
    await api('PUT', { place_id: place.id, lat, lng }, '', '/api/place-location');
    await page.reloadPlaces();
    const updated = state.places.find((candidate) => candidate.id === place.id);
    if (updated) page.showCard(updated);
  } catch (error) {
    alert(`儲存位置失敗：${error.message}`);
    renderMarkers();
  }
});

$('drag-cancel').addEventListener('click', () => {
  endDrag();
  renderMarkers();
});

// ---- Finding a shop on Google ----
const locateDialog = $('locate-dialog');
const locateForm = $('locate-form');
const locateMessage = $('locate-message');
let locatingPlace = null;

// First time: search Google by the shop name right away. Fixing a position: wait for the person to type the
// exact address (no search spent until they press 搜尋); dragging the pin stays available as a fallback.
export function openLocateDialog(place) {
  locatingPlace = place;
  const isFixing = isLocated(place);
  $('locate-title').textContent = isFixing ? `修正「${place.name || '這家店'}」的位置` : `${place.name || '這家店'}在哪裡？`;
  locateForm.elements.query.value = isFixing ? place.address ?? '' : '';
  $('locate-candidates').replaceChildren();
  openDialog(locateDialog);
  if (isFixing) {
    locateMessage.textContent = '輸入完整地址（例如：台北市大安區復興南路一段 1 號）或店名，再按搜尋';
    locateForm.elements.query.focus();
  } else if (place.name) {
    searchLocation();
  } else {
    locateMessage.textContent = '還沒有店名，請輸入店名或完整地址';
  }
}

async function searchLocation() {
  const place = locatingPlace;
  locateMessage.textContent = '搜尋中…';
  try {
    const { query, candidates } = await api('POST', { place_id: place.id, query: locateForm.elements.query.value }, '', '/api/place-search');
    locateForm.elements.query.value = query;
    $('locate-candidates').replaceChildren(...candidates.map((candidate) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      const name = document.createElement('strong');
      name.textContent = candidate.name;
      const address = document.createElement('span');
      address.textContent = candidate.address;
      button.append(name, address);
      button.addEventListener('click', () => chooseLocation(place, candidate));
      item.append(button);
      return item;
    }));
    locateMessage.textContent = candidates.length ? '點選正確的那一家' : '找不到，換個關鍵字，或自己在地圖上放';
  } catch (error) {
    locateMessage.textContent = error.message;
  }
}

async function chooseLocation(place, candidate) {
  locateMessage.textContent = '儲存中…';
  try {
    const { google_place_id, lat, lng } = candidate;
    await api('PUT', { place_id: place.id, google_place_id, lat, lng }, '', '/api/place-location');
    locateDialog.close('cancel');
    await page.reloadPlaces();
    const updated = state.places.find((candidateRow) => candidateRow.id === place.id);
    if (updated) page.focusPlace(updated);
  } catch (error) {
    locateMessage.textContent = `儲存失敗：${error.message}`;
  }
}

// Enter in the search box submits the form; keep the dialog open and search instead of closing it.
locateForm.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'search') return;
  event.preventDefault();
  searchLocation();
});

locateDialog.addEventListener('close', () => {
  const place = locatingPlace;
  locatingPlace = null;
  if (place && locateDialog.returnValue === 'manual') startDrag(place);
});


// ---- Called by app.js ----
export function panToPlace(place) {
  if (!map || !isLocated(place)) return;
  map.panTo(latLngOf(place));
  map.setZoom(Math.max(map.getZoom(), 15));
}

/** After a 幾公里內 chip: show the whole range. */
export function fitToRadius() {
  if (map && radiusCircle?.getMap()) map.fitBounds(radiusCircle.getBounds(), 24);
}

/** A different list: drop any pin being placed and frame the new shops once. */
export function resetMapForNewList() {
  if (dragMarker) endDrag(); // the shop being placed belongs to the list being left
  hasFittedMap = false;
}
