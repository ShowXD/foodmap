const $ = (id) => document.getElementById(id);
const searchInput = $('search');
const placeList = $('place-list');
const listMessage = $('list-message');
const filterChips = $('filter-chips');
const addForm = $('add-form');
const formMessage = $('form-message');
const placeTemplate = $('place-template');
const listSelect = $('list-select');
const visitDialog = $('visit-dialog');
const visitForm = $('visit-form');

const VIEWS = ['map', 'list', 'add', 'random', 'me'];
const LIST_STORAGE_KEY = 'foodmap.list';
const LAYOUT_STORAGE_KEY = 'foodmap.layout';
const EDIT_FIELDS = ['name', 'dishes', 'area', 'address', 'tags', 'caption', 'note'];

const TAIWAN = { lat: 23.7, lng: 120.96 };

let lists = [];
let currentListId = null;
let places = [];
let filter = { mode: 'all', tag: null };
let layout = readSetting(LAYOUT_STORAGE_KEY) === 'grid' ? 'grid' : 'rows';
let myPosition = null;
let locationError = null;

const mapsUrl = (place) => {
  const query = encodeURIComponent([place.name, place.address || place.area].filter(Boolean).join(' '));
  return `https://www.google.com/maps/search/?api=1&query=${query}${place.google_place_id ? `&query_place_id=${encodeURIComponent(place.google_place_id)}` : ''}`;
};
const isLocated = (place) => place.lat != null && place.lng != null;
// LINE places may have only a link (no name) or no map position yet.
const needsTidying = (place) => !place.name || !isLocated(place);
const tagsOf = (place) => String(place.tags ?? '').split(/\s+/).filter(Boolean);

function distanceKm(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const a = Math.sin(radians(to.lat - from.lat) / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(radians(to.lng - from.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
const distanceTo = (place) => (myPosition && isLocated(place) ? distanceKm(myPosition, place) : null);
const formatDistance = (km) => (km < 1 ? `${Math.round(km * 1000)} 公尺` : `${km.toFixed(1)} 公里`);

async function api(method, body, query = '', path = '/api/places') {
  const response = await fetch(`${path}${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // 401: the Access session expired, so reloading sends the browser through the Access login.
  if (response.status === 401) {
    location.reload();
    throw new Error('請重新登入');
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403 && payload.error === 'account disabled') {
    location.href = '/pending';
    throw new Error('帳號已停用');
  }
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { status: response.status });
  return payload;
}

// ---- Views (hash routing keeps the phone's back button working) ----
let currentView = null;
let hasShownView = false; // the first render (e.g. opening straight into #add from a share) shouldn't animate

function showView() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'map';
  // Not body.dataset.view: an animated switch updates that later, after a following hashchange may already run.
  const previous = currentView;
  currentView = view;
  // The shop card belongs to the page that opened it. Done before the (async) transition update,
  // so a caller can open a card right after switching pages.
  if (hasShownView && previous !== view) hideMapCard();
  const update = () => {
    document.body.dataset.view = view;
    for (const tab of document.querySelectorAll('.tabbar a')) {
      tab.toggleAttribute('aria-current', tab.dataset.tab === view);
    }
    window.scrollTo(0, 0);
  };
  // Slide toward the tab that was picked; browsers without View Transitions just switch instantly.
  const canAnimate = document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (canAnimate && hasShownView && previous !== view) {
    document.documentElement.dataset.direction = VIEWS.indexOf(view) > VIEWS.indexOf(previous) ? 'forward' : 'back';
    document.startViewTransition(update);
  } else {
    update();
  }
  hasShownView = true;
  // Every map created is a billed map load, so only create it once someone actually opens the map.
  if (view === 'map' && !mapReady) {
    mapReady = initMap();
    mapReady.catch(showMapFallback);
  }
}
window.addEventListener('hashchange', showView);

// ---- Place cards ----
function familySummary(place) {
  const parts = [];
  if (place.visit_count) parts.push(`${place.visit_count} 人吃過`);
  if (place.avg_rating) parts.push(`平均 ${place.avg_rating} 分`);
  return parts.join(' · ');
}

// The video's preview image; when there is none, the frame's CSS placeholder shows instead.
function thumbnailFor(place, className) {
  const frame = document.createElement('div');
  frame.className = `thumb ${className}`;
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.alt = '';
  image.src = `/thumb/${place.id}`;
  image.addEventListener('error', () => image.remove());
  frame.append(image);
  return frame;
}

// A compact row (layout "rows") or a thumbnail tile (layout "grid"); tapping opens the full card.
function renderListItem(place, itemLayout) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = itemLayout === 'grid' ? 'tile' : 'row';
  button.classList.toggle('visited', Boolean(place.my_visited_at));

  const name = document.createElement('strong');
  name.textContent = place.name || '（待整理）';
  const distance = distanceTo(place);
  const details = document.createElement('span');
  details.className = 'meta';
  details.textContent = [distance != null && formatDistance(distance), itemLayout === 'grid' ? '' : place.dishes, place.area]
    .filter(Boolean).join(' · ');
  const marks = document.createElement('span');
  marks.className = 'marks';
  marks.textContent = [
    place.is_new && '新',
    place.starred && '★',
    place.my_visited_at && (place.my_rating ? `✓${place.my_rating}` : '✓'),
  ].filter(Boolean).join(' ');

  const text = document.createElement('span');
  text.className = 'item-text';
  text.append(name, details);
  button.append(thumbnailFor(place, itemLayout === 'grid' ? 'thumb-tile' : 'thumb-row'), text, marks);
  button.addEventListener('click', () => showMapCard(place));
  item.append(button);
  return item;
}

function renderPlace(place) {
  const card = placeTemplate.content.firstElementChild.cloneNode(true);
  card.prepend(thumbnailFor(place, 'thumb-card'));
  const isVisited = Boolean(place.my_visited_at);
  card.classList.toggle('visited', isVisited);
  card.querySelector('.name').textContent = place.name || '（待整理：還沒有店名）';
  card.querySelector('.badge-new').hidden = !place.is_new;
  card.querySelector('.dishes').textContent = place.dishes || '';
  const distance = distanceTo(place);
  card.querySelector('.meta').textContent = [
    distance != null && `📍 ${formatDistance(distance)}`,
    place.area,
    place.tags,
    place.source === 'line' && '來自 LINE',
  ].filter(Boolean).join(' · ');
  card.querySelector('.family').textContent = familySummary(place);
  card.querySelector('.note').textContent = [place.note, place.my_note && `我的心得：${place.my_note}`].filter(Boolean).join('\n');
  card.querySelector('.video').href = place.url;

  const mapsLink = card.querySelector('.maps');
  if (place.name) mapsLink.href = mapsUrl(place);
  else mapsLink.remove();

  const star = card.querySelector('.star');
  star.textContent = place.starred ? '★' : '☆';
  star.classList.toggle('on', Boolean(place.starred));
  star.setAttribute('aria-pressed', String(Boolean(place.starred)));
  star.addEventListener('click', () => toggleStar(place, star));

  const visit = card.querySelector('.visit');
  visit.textContent = isVisited ? `吃過${place.my_rating ? ` ${place.my_rating}★` : ''}` : '吃過了';
  visit.classList.toggle('secondary', isVisited);
  visit.addEventListener('click', () => openVisitDialog(place));
  const locate = card.querySelector('.locate');
  locate.textContent = isLocated(place) ? '修正位置' : '📍 定位';
  locate.addEventListener('click', () => (isLocated(place) ? startDrag(place) : openLocateDialog(place)));
  card.querySelector('.share').addEventListener('click', () => sharePlace(place));
  card.querySelector('.edit').addEventListener('click', () => startEdit(place));
  return card;
}

async function toggleStar(place, button) {
  button.disabled = true;
  try {
    await api(place.starred ? 'DELETE' : 'PUT', { place_id: place.id }, '', '/api/stars');
    place.starred = place.starred ? 0 : 1;
    renderPlaces();
  } catch (error) {
    alert(`更新失敗：${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function sharePlace(place) {
  const title = place.name || '美食';
  const text = [title, place.dishes, place.name ? mapsUrl(place) : ''].filter(Boolean).join('\n');
  try {
    if (navigator.share) await navigator.share({ title, text, url: place.url });
    else {
      await navigator.clipboard.writeText(`${text}\n${place.url}`);
      alert('已複製，可以貼到 LINE 了');
    }
  } catch (error) {
    if (error.name !== 'AbortError') alert(`分享失敗：${error.message}`);
  }
}

// ---- 吃過 + rating dialog ----
let visitingPlace = null;

async function openVisitDialog(place) {
  visitingPlace = place;
  $('visit-title').textContent = `${place.name || '這家店'}・吃過了`;
  visitForm.reset();
  if (place.my_rating) visitForm.elements.rating.value = String(place.my_rating);
  visitForm.elements.note.value = place.my_note ?? '';
  $('visit-remove').hidden = !place.my_visited_at;
  const others = $('visit-others');
  others.replaceChildren();
  visitDialog.showModal();
  try {
    const visits = await api('GET', null, `?place=${place.id}`, '/api/visits');
    others.replaceChildren(...visits.filter((v) => !v.is_mine).map((v) => {
      const item = document.createElement('li');
      item.textContent = `${v.name || v.email.split('@')[0]}：${v.rating ? `${v.rating} 分` : '吃過'}${v.note ? `，${v.note}` : ''}`;
      return item;
    }));
  } catch (error) {
    console.error('Failed to load family visits', error);
  }
}

visitDialog.addEventListener('close', async () => {
  const place = visitingPlace;
  visitingPlace = null;
  if (!place || !['save', 'remove'].includes(visitDialog.returnValue)) return;
  try {
    if (visitDialog.returnValue === 'remove') {
      await api('DELETE', { place_id: place.id }, '', '/api/visits');
    } else {
      const rating = visitForm.elements.rating.value ? Number(visitForm.elements.rating.value) : null;
      await api('PUT', { place_id: place.id, rating, note: visitForm.elements.note.value }, '', '/api/visits');
    }
    await loadPlaces();
  } catch (error) {
    alert(`更新失敗：${error.message}`);
  }
});

// ---- Filters ----
function chip(label, isActive, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(isActive));
  button.addEventListener('click', onClick);
  return button;
}

function matchesFilter(place) {
  if (filter.mode === 'todo' && place.my_visited_at) return false;
  if (filter.mode === 'visited' && !place.my_visited_at) return false;
  if (filter.mode === 'starred' && !place.starred) return false;
  if (filter.mode === 'untidy' && !needsTidying(place)) return false;
  if (filter.mode === 'near' && distanceTo(place) == null) return false;
  if (filter.tag && !tagsOf(place).includes(filter.tag)) return false;
  return true;
}

function renderChips() {
  const untidy = places.filter(needsTidying).length;
  const modes = [['all', '全部'], ['todo', '未吃'], ['visited', '吃過'], ['starred', '★ 想吃']];
  if (myPosition) modes.splice(1, 0, ['near', '📍 附近']);
  if (untidy) modes.push(['untidy', `待整理 ${untidy}`]);
  const tags = [...new Set(places.flatMap(tagsOf))].sort();
  // The list and the map share one filter, so both rows show the same chips.
  for (const container of [filterChips, $('map-chips')]) {
    container.replaceChildren(
      ...modes.map(([mode, label]) => chip(label, filter.mode === mode, () => { filter.mode = mode; renderPlaces(); })),
      ...tags.map((tag) => chip(`#${tag}`, filter.tag === tag, () => { filter.tag = filter.tag === tag ? null : tag; renderPlaces(); })),
    );
  }
}

function renderPlaces() {
  renderRandomTags();
  renderChips();
  const shown = places.filter(matchesFilter);
  if (filter.mode === 'near') shown.sort((a, b) => distanceTo(a) - distanceTo(b));
  renderMarkers();
  refreshMapCard();
  placeList.className = layout === 'grid' ? 'place-grid' : 'place-rows';
  for (const button of document.querySelectorAll('.layout-toggle button')) {
    button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  }
  placeList.replaceChildren(...shown.map((place) => renderListItem(place, layout)));
  const query = searchInput.value.trim();
  if (shown.length) listMessage.textContent = '';
  else if (places.length) listMessage.textContent = '沒有符合篩選的店';
  else listMessage.textContent = query ? '找不到符合的店' : '還沒有收藏，按下方＋新增一家吧';
}

async function loadPlaces({ markRead = false } = {}) {
  if (!currentListId) return;
  const query = searchInput.value.trim();
  listMessage.textContent = '載入中…';
  try {
    places = await api('GET', null, `?list=${currentListId}${query ? `&q=${encodeURIComponent(query)}` : ''}`);
    renderPlaces();
    // Remember this visit so places added afterwards show as "新" next time.
    if (markRead) api('POST', { list_id: currentListId }, '', '/api/list-read').catch((error) => console.error('list-read failed', error));
  } catch (error) {
    listMessage.textContent = `載入失敗：${error.message}`;
  }
}

for (const button of document.querySelectorAll('.layout-toggle button')) {
  button.addEventListener('click', () => {
    layout = button.dataset.layout;
    saveSetting(LAYOUT_STORAGE_KEY, layout);
    renderPlaces();
  });
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadPlaces, 300);
});

// ---- Map ----
const mapCard = $('map-card');
let mapReady = null;
let map = null;
let markerLibrary = null;
let markers = [];
let myMarker = null;
let hasFittedMap = false;
let mapCardPlaceId = null;
let draggingPlace = null;
let dragMarker = null;

function showMapFallback(error) {
  console.error('Map unavailable', error);
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

async function initMap() {
  const config = await api('GET', null, '', '/api/config');
  if (!config.mapsKey || !config.mapId) throw new Error('地圖尚未設定');
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
    else hideMapCard();
  });
  showMyPosition(true);
  renderMarkers();
}

const latLngOf = (place) => ({ lat: place.lat, lng: place.lng });
const PIN_COLORS = { starred: ['#f59f00', '#b37400'], visited: ['#adb5bd', '#868e96'], todo: ['#d9480f', '#a8380b'] };

function pinFor(place) {
  const [background, borderColor] = PIN_COLORS[place.starred ? 'starred' : place.my_visited_at ? 'visited' : 'todo'];
  return new markerLibrary.PinElement({ background, borderColor, glyphColor: '#fff' });
}

function renderMarkers() {
  if (!map) return;
  for (const marker of markers) marker.map = null;
  const shown = places.filter((place) => isLocated(place) && matchesFilter(place) && place.id !== draggingPlace?.id);
  markers = shown.map((place) => {
    const marker = new markerLibrary.AdvancedMarkerElement({ map, position: latLngOf(place), title: place.name || '', content: pinFor(place), gmpClickable: true });
    marker.addEventListener('gmp-click', () => showMapCard(place));
    return marker;
  });
  // Frame the shops once per list; after that the map stays where the person moved it.
  if (!hasFittedMap && shown.length) {
    hasFittedMap = true;
    fitToPlaces(shown);
  }
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
  const shown = places.filter((place) => isLocated(place) && matchesFilter(place));
  if (map && shown.length) fitToPlaces(shown);
});

function watchMyPosition() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (position) => {
      const isFirstFix = !myPosition;
      myPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
      showMyPosition(isFirstFix);
      if (isFirstFix) renderPlaces(); // distances and the 附近 chip appear
    },
    (error) => {
      locationError = error;
      console.warn('Location unavailable', error.message);
    },
    { enableHighAccuracy: true, maximumAge: 60000 },
  );
}

// Runs on every location fix and once the map is ready, whichever comes last draws the dot.
function showMyPosition(shouldCenter) {
  if (!map || !myPosition) return;
  if (myMarker) {
    myMarker.position = myPosition;
    return;
  }
  const dot = document.createElement('div');
  dot.className = 'my-dot';
  myMarker = new markerLibrary.AdvancedMarkerElement({ map, position: myPosition, content: dot, title: '我的位置', zIndex: 1000 });
  if (shouldCenter && !places.some(isLocated)) {
    map.setCenter(myPosition);
    map.setZoom(14);
  }
}

$('locate-me').addEventListener('click', () => {
  if (!myPosition) {
    alert(locationError?.code === 1
      ? '沒有定位權限。請到瀏覽器或手機設定，允許這個網站使用位置'
      : '還在取得你的位置，請稍候再按一次');
    return;
  }
  if (!map) return;
  map.panTo(myPosition);
  map.setZoom(Math.max(map.getZoom(), 15));
});

function showMapCard(place) {
  mapCardPlaceId = place.id;
  mapCard.querySelector('ul').replaceChildren(renderPlace(place));
  mapCard.hidden = false;
}

function hideMapCard() {
  mapCardPlaceId = null;
  mapCard.hidden = true;
}
$('map-card-close').addEventListener('click', hideMapCard);

// Keeps the open card in sync after 吃過/★/編輯 reload the list.
function refreshMapCard() {
  const place = places.find((candidate) => candidate.id === mapCardPlaceId);
  if (place) showMapCard(place);
  else hideMapCard();
}

function focusPlace(place) {
  location.hash = '#map';
  showView(); // switch now (hashchange comes later) so the card isn't closed by the page change
  showMapCard(place);
  if (map && isLocated(place)) {
    map.panTo(latLngOf(place));
    map.setZoom(Math.max(map.getZoom(), 15));
  }
}

// ---- Fixing a position by dragging ----
async function startDrag(place) {
  location.hash = '#map';
  showView(); // starts the map now if it was never opened; hashchange fires too late to await it
  try {
    await mapReady;
  } catch {
    alert('地圖無法使用，沒辦法放標點');
    return;
  }
  hideMapCard();
  draggingPlace = place;
  const position = isLocated(place) ? latLngOf(place) : myPosition ?? map.getCenter().toJSON();
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
    await loadPlaces();
    const updated = places.find((candidate) => candidate.id === place.id);
    if (updated) showMapCard(updated);
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

function openLocateDialog(place) {
  locatingPlace = place;
  $('locate-title').textContent = `${place.name || '這家店'}在哪裡？`;
  locateForm.elements.query.value = '';
  $('locate-candidates').replaceChildren();
  locateDialog.showModal();
  if (place.name) searchLocation();
  else locateMessage.textContent = '還沒有店名，請輸入要搜尋的文字';
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
    await loadPlaces();
    const updated = places.find((candidateRow) => candidateRow.id === place.id);
    if (updated) focusPlace(updated);
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

// ---- 今天吃什麼 ----
const randomTag = $('random-tag');
const randomMessage = $('random-message');
let randomPick = null;

function renderRandomTags() {
  const chosen = randomTag.value;
  const tags = [...new Set(places.flatMap(tagsOf))].sort();
  randomTag.replaceChildren(new Option('全部', ''), ...tags.map((tag) => new Option(`#${tag}`, tag)));
  randomTag.value = tags.includes(chosen) ? chosen : '';
}

$('random-pick').addEventListener('click', () => {
  const radius = Number($('random-radius').value);
  const includeVisited = $('random-include-visited').checked;
  let candidates = places.filter((place) => place.name && (includeVisited || !place.my_visited_at) && (!randomTag.value || tagsOf(place).includes(randomTag.value)));
  const notes = [];
  if (radius && myPosition) candidates = candidates.filter((place) => (distanceTo(place) ?? Infinity) <= radius);
  else if (radius) notes.push('還沒取得你的位置，先從所有店家裡抽');

  if (!candidates.length) {
    randomPick = null;
    $('random-result').replaceChildren();
    $('random-on-map').hidden = true;
    randomMessage.textContent = '沒有符合條件的店，放寬距離或標籤再試試';
    return;
  }
  randomPick = candidates[Math.floor(Math.random() * candidates.length)];
  notes.push(`從 ${candidates.length} 家裡抽中：`);
  randomMessage.textContent = notes.join('。');
  $('random-result').replaceChildren(renderPlace(randomPick));
  $('random-on-map').hidden = !isLocated(randomPick);
});

$('random-on-map').addEventListener('click', () => {
  if (randomPick) focusPlace(randomPick);
});

// ---- Add / edit form ----
const cancelEditButton = $('cancel-edit');
const candidatesPanel = $('ai-candidates');
const candidateList = $('candidate-list');
const saveCandidatesButton = $('save-candidates');
let candidates = [];

function startEdit(place) {
  for (const field of EDIT_FIELDS) addForm.elements[field].value = place[field] ?? '';
  addForm.elements.url.value = place.url;
  addForm.elements.url.readOnly = true;
  addForm.elements.id.value = place.id;
  addForm.querySelector('button[type="submit"]').textContent = '更新';
  $('add-title').textContent = '編輯店家';
  cancelEditButton.hidden = false;
  formMessage.textContent = '';
  location.hash = '#add';
}

// Hidden inputs keep values set by script across reset(), so restore them explicitly.
function resetForm() {
  addForm.reset();
  addForm.elements.source.value = 'manual';
  addForm.elements.id.value = '';
  addForm.elements.url.readOnly = false;
  addForm.querySelector('button[type="submit"]').textContent = '儲存';
  $('add-title').textContent = '新增店家';
  cancelEditButton.hidden = true;
  hideCandidates();
}

cancelEditButton.addEventListener('click', () => {
  resetForm();
  formMessage.textContent = '';
  location.hash = '#list';
});

// Only fill blanks so AI never overwrites what someone typed by hand.
function fillBlanks(place) {
  for (const [field, text] of Object.entries(place)) {
    if (text && !addForm.elements[field].value.trim()) addForm.elements[field].value = text;
  }
}

function showCandidates(found) {
  candidates = found;
  candidateList.replaceChildren(...found.map((place, index) => {
    const label = document.createElement('label');
    label.className = 'candidate';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.value = index;
    const summary = document.createElement('span');
    summary.textContent = [place.name || '（未填店名）', place.dishes, place.area].filter(Boolean).join('・');
    label.append(checkbox, summary);
    return label;
  }));
  candidatesPanel.hidden = false;
}

function hideCandidates() {
  candidates = [];
  candidateList.replaceChildren();
  candidatesPanel.hidden = true;
}

saveCandidatesButton.addEventListener('click', async () => {
  const chosen = [...candidateList.querySelectorAll('input:checked')].map((checkbox) => candidates[checkbox.value]);
  if (chosen.length === 0) {
    formMessage.textContent = '請至少勾選一家店';
    return;
  }
  const { url, caption, source, note } = addForm.elements;
  saveCandidatesButton.disabled = true;
  formMessage.textContent = '儲存中…';
  const counts = { saved: 0, duplicate: 0, failed: 0 };
  for (const place of chosen) {
    try {
      await api('POST', { ...place, list_id: currentListId, url: url.value, caption: caption.value, source: source.value, note: note.value });
      counts.saved++;
    } catch (error) {
      if (error.status === 409) counts.duplicate++;
      else counts.failed++;
    }
  }
  saveCandidatesButton.disabled = false;
  formMessage.textContent = [
    `已儲存 ${counts.saved} 家`,
    counts.duplicate && `${counts.duplicate} 家之前存過`,
    counts.failed && `${counts.failed} 家失敗，請檢查影片連結後再試`,
  ].filter(Boolean).join('，');
  if (counts.failed === 0) resetForm();
  loadPlaces();
});

const aiFillButton = $('ai-fill');
aiFillButton.addEventListener('click', async () => {
  const { url, caption } = addForm.elements;
  if (!url.value.trim() && !caption.value.trim()) {
    formMessage.textContent = '請先填影片連結或貼文文字';
    return;
  }
  aiFillButton.disabled = true;
  formMessage.textContent = 'AI 擷取中…';
  try {
    const extracted = await api('POST', { url: url.value, caption: caption.value }, '', '/api/extract');
    caption.value = extracted.caption;
    const isEditing = Boolean(addForm.elements.id.value);
    if (extracted.places.length === 1 || isEditing) {
      hideCandidates();
      fillBlanks(extracted.places[0]);
      formMessage.textContent = 'AI 已填入，請確認後再儲存';
    } else {
      showCandidates(extracted.places);
      formMessage.textContent = `AI 找到 ${extracted.places.length} 家店，勾選要存的再按「儲存勾選的店家」`;
    }
  } catch (error) {
    formMessage.textContent = error.message;
    if (error.status === 422) caption.focus();
  } finally {
    aiFillButton.disabled = false;
  }
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = addForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  formMessage.textContent = '儲存中…';
  const formFields = Object.fromEntries(new FormData(addForm));
  const editingId = Number(formFields.id);
  try {
    if (editingId) await api('PATCH', { ...formFields, id: editingId });
    else await api('POST', { ...formFields, list_id: currentListId });
    resetForm();
    formMessage.textContent = editingId ? '已更新' : '已儲存';
    await loadPlaces();
    if (editingId) location.hash = '#list';
  } catch (error) {
    formMessage.textContent = error.status === 409 ? '這個連結已經收藏過了' : `儲存失敗：${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

// Android share target lands here as /?title=&text=&url=; LINE usually puts the link inside `text`.
function prefillFromShare() {
  const params = new URLSearchParams(location.search);
  const sharedText = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  const sharedUrl = sharedText.match(/https?:\/\/\S+/)?.[0];
  if (!sharedUrl) return;
  addForm.elements.url.value = sharedUrl;
  addForm.elements.caption.value = sharedText.replaceAll(sharedUrl, '').trim();
  addForm.elements.source.value = 'share';
  history.replaceState(null, '', `${location.pathname}#add`);
}

// ---- Lists and "我的" ----
// Remembering the last list is a convenience; storage can be blocked (private mode), so failures just fall back.
function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering the choice is fine.
  }
}

function readSavedListId() {
  try {
    return Number(localStorage.getItem(LIST_STORAGE_KEY));
  } catch {
    return 0;
  }
}

function selectList(listId) {
  const list = lists.find((candidate) => candidate.id === listId) ?? lists[0];
  currentListId = list.id;
  listSelect.value = String(list.id);
  $('members-link').hidden = Boolean(list.is_personal);
  $('members-link').href = `/members?list=${list.id}`;
  $('export-link').href = `/api/export?list=${list.id}`;
  filter = { mode: 'all', tag: null };
  try {
    localStorage.setItem(LIST_STORAGE_KEY, String(list.id));
  } catch {
    // Not remembering the choice is fine.
  }
}

async function loadLists() {
  lists = await api('GET', null, '', '/api/lists');
  listSelect.replaceChildren(...lists.map((list) => new Option(`${list.is_personal ? '👤' : '👥'} ${list.name}`, list.id)));
  selectList(readSavedListId());
}

listSelect.addEventListener('change', () => {
  selectList(Number(listSelect.value));
  resetForm();
  hideMapCard();
  hasFittedMap = false;
  loadPlaces({ markRead: true });
});

// ---- Profile: name and photo shown on 我的 and on the tab ----
const profileDialog = $('profile-dialog');
const profileForm = $('profile-form');
const MAX_NAME_LENGTH = 30;
const AVATAR_SIZE = 256;
let profile = null;

const displayName = (person) => person.name || person.email.split('@')[0];

function renderAvatar(element, person) {
  // A steady colour per person, so initials are easy to tell apart.
  element.style.setProperty('--avatar-hue', String((person.id * 47) % 360));
  if (person.avatarVersion) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = `/avatar/${person.id}?v=${encodeURIComponent(person.avatarVersion)}`;
    element.replaceChildren(image);
  } else {
    element.textContent = Array.from(displayName(person))[0].toUpperCase();
  }
}

function applyProfile() {
  $('profile-name').textContent = displayName(profile);
  $('user-email').textContent = profile.email;
  $('tab-name').textContent = displayName(profile);
  $('admin-link').hidden = !profile.isAdmin;
  renderAvatar($('avatar-button'), profile);
  renderAvatar($('tab-avatar'), profile);
}

// Google sign-ins usually carry the person's name; email-code sign-ins don't, so this may find nothing.
async function nameFromSignIn() {
  try {
    const response = await fetch('/cdn-cgi/access/get-identity');
    if (!response.ok) return null;
    const identity = await response.json();
    return typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim().slice(0, MAX_NAME_LENGTH) : null;
  } catch {
    return null;
  }
}

async function saveName(name) {
  ({ name: profile.name } = await api('PATCH', { display_name: name }, '', '/api/me'));
  applyProfile();
}

// Square-crops and shrinks to a small JPEG in the browser, so uploads stay tiny whatever the phone camera produced.
async function squareJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  canvas.getContext('2d').drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('無法處理這張圖片'))), 'image/jpeg', 0.85);
  });
}

$('avatar-file').addEventListener('change', async () => {
  const file = $('avatar-file').files[0];
  $('avatar-file').value = '';
  if (!file) return;
  try {
    const response = await fetch('/api/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: await squareJpeg(file) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    profile.avatarVersion = payload.avatarVersion;
    applyProfile();
  } catch (error) {
    alert(`更換大頭貼失敗：${error.message}`);
  }
});

const pickAvatar = () => $('avatar-file').click();
$('avatar-button').addEventListener('click', pickAvatar);
$('change-avatar').addEventListener('click', () => {
  profileDialog.close('cancel');
  pickAvatar();
});

$('remove-avatar').addEventListener('click', async () => {
  try {
    ({ avatarVersion: profile.avatarVersion } = await api('DELETE', null, '', '/api/avatar'));
    applyProfile();
    $('remove-avatar').hidden = true;
  } catch (error) {
    alert(`移除失敗：${error.message}`);
  }
});

$('edit-profile').addEventListener('click', () => {
  profileForm.elements.display_name.value = displayName(profile);
  $('remove-avatar').hidden = !profile.avatarVersion;
  profileDialog.showModal();
});

profileDialog.addEventListener('close', async () => {
  if (profileDialog.returnValue !== 'save') return;
  try {
    await saveName(profileForm.elements.display_name.value);
  } catch (error) {
    alert(`儲存失敗：${error.message}`);
  }
});

api('GET', null, '', '/api/me')
  .then(async (me) => {
    profile = me;
    applyProfile();
    if (!profile.name) {
      const name = await nameFromSignIn();
      if (name) await saveName(name);
    }
  })
  .catch((error) => console.error('Failed to load current user', error));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error('Service worker registration failed', error));
}

prefillFromShare();
watchMyPosition();
showView();
loadLists()
  .then(() => loadPlaces({ markRead: true }))
  .catch((error) => {
    listMessage.textContent = `載入清單失敗：${error.message}`;
  });
