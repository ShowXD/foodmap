import { prefillFromShare, resetForm, startEdit } from './add-form.js';
import { showAdmin } from './admin.js';
import './me.js';
import { showMembers } from './members.js';
import {
  connectMap, ensureMap, fitToRadius, openLocateDialog, panToPlace, renderMarkers, resetMapForNewList, watchMyPosition,
} from './map.js';
import { $, api, openDialog, readSetting, saveSetting } from './shared.js';
import {
  distanceTo, formatDistance, isLocated, mapsUrl, matchesFilter, PLACE_ISSUES, state, tagsOf,
} from './state.js';

const searchInput = $('search');
const placeList = $('place-list');
const listMessage = $('list-message');
const filterChips = $('filter-chips');
const placeTemplate = $('place-template');
const listSelect = $('list-select');
const visitDialog = $('visit-dialog');
const visitForm = $('visit-form');

const VIEWS = ['map', 'list', 'add', 'random', 'me', 'members', 'usage', 'groups', 'line-groups', 'accounts'];
const LIST_STORAGE_KEY = 'foodmap.list';
const LAYOUT_STORAGE_KEY = 'foodmap.layout';

const NEAR_RADII_KM = [1, 3, 5];
let layout = readSetting(LAYOUT_STORAGE_KEY) === 'grid' ? 'grid' : 'rows';
// ---- Views (hash routing keeps the phone's back button working) ----
let currentView = null;
let hasShownView = false; // the first render (e.g. opening straight into #add from a share) shouldn't animate

// Pages opened from 我的 keep that tab highlighted.
const ADMIN_VIEWS = ['usage', 'groups', 'line-groups', 'accounts'];
const PARENT_TAB = { members: 'list', ...Object.fromEntries(ADMIN_VIEWS.map((view) => [view, 'me'])) };

function showView() {
  // Hashes look like "#list" or "#members?list=3".
  const [route, query = ''] = location.hash.slice(1).split('?');
  const view = VIEWS.includes(route) ? route : 'map';
  if (ADMIN_VIEWS.includes(view)) showAdmin(view);
  if (view === 'members') showMembers(Number(new URLSearchParams(query).get('list')) || state.currentListId);
  // Not body.dataset.view: an animated switch updates that later, after a following hashchange may already run.
  const previous = currentView;
  currentView = view;
  // The shop card belongs to the page that opened it. Done before the (async) transition update,
  // so a caller can open a card right after switching pages.
  if (hasShownView && previous !== view) hideMapCard();
  const update = () => {
    document.body.dataset.view = view;
    for (const section of document.querySelectorAll('.view')) section.classList.toggle('is-active', section.dataset.view === view);
    for (const tab of document.querySelectorAll('.tabbar a')) {
      // An empty aria-current counts as "false" for screen readers; it has to say which kind of current.
      if (tab.dataset.tab === (PARENT_TAB[view] ?? view)) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
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
  if (view === 'map') ensureMap();
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
  name.textContent = place.name || '（還沒有店名）';
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
  card.querySelector('.name').textContent = place.name || '（還沒有店名）';
  card.querySelector('.badge-new').hidden = !place.is_new;
  card.querySelector('.dishes').textContent = place.dishes || '';
  const distance = distanceTo(place);
  card.querySelector('.meta').textContent = [
    distance != null && `📍 ${formatDistance(distance)}`,
    place.area,
    place.tags,
    place.source === 'line' && '來自 LINE',
    place.garbled?.length && `⚠️ 疑似亂碼：${place.garbled.map((field) => GARBLED_LABELS[field]).join('、')}`,
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
  const myRating = place.my_rating ? ` ${place.my_rating}★` : '';
  visit.textContent = isVisited ? `吃過${myRating}` : '吃過了';
  visit.classList.toggle('secondary', isVisited);
  visit.addEventListener('click', () => openVisitDialog(place));
  const locate = card.querySelector('.locate');
  locate.textContent = isLocated(place) ? '修正位置' : '📍 定位';
  locate.addEventListener('click', () => openLocateDialog(place));
  card.querySelector('.share').addEventListener('click', () => sharePlace(place));
  card.querySelector('.edit').addEventListener('click', () => startEdit(place));
  const reanalyze = card.querySelector('.reanalyze');
  // LINE links saved after the day's AI limit keep their post text but no shop details.
  reanalyze.hidden = !canReanalyze(place);
  reanalyze.addEventListener('click', () => reanalyzePlace(place, reanalyze));
  return card;
}

// The server fills it from its saved post text, adds the post's other shops, and locates them.
async function reanalyzePlace(place, button) {
  button.disabled = true;
  button.textContent = 'AI 分析中…';
  try {
    const { located } = await api('POST', { place_id: place.id }, '', '/api/reanalyze');
    await loadPlaces();
    // Named now but not on the map yet (沒定位): let the person pick the right shop.
    const updated = state.places.find((candidate) => candidate.id === place.id);
    if (!located && updated) openLocateDialog(updated);
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = '✨ AI 重新分析';
  }
}

const GARBLED_LABELS = { name: '店名', address: '地址', area: '地區' };
// Nameless, or garbled by an earlier AI run; either way the saved post text is there to try again.
const canReanalyze = (place) => Boolean(place.caption) && (!place.name || Boolean(place.garbled?.length));
const reanalyzeAllButton = $('reanalyze-all');
reanalyzeAllButton.addEventListener('click', async () => {
  const waiting = state.places.filter(canReanalyze);
  reanalyzeAllButton.disabled = true;
  let done = 0;
  let named = 0;
  let notLocated = 0;
  let stopped = null;
  try {
    // One at a time: each is a few seconds of AI, and a quota error should stop the rest.
    for (const place of waiting) {
      reanalyzeAllButton.textContent = `AI 分析中 ${done + 1}/${waiting.length}…`;
      const result = await api('POST', { place_id: place.id }, '', '/api/reanalyze').catch((error) => {
        if (error.status !== 422 && error.status !== 409) throw error; // nothing found / named meanwhile: skip it
        return null;
      });
      done++;
      if (result) named++;
      if (result && !result.located) notLocated++;
    }
  } catch (error) {
    stopped = error;
  } finally {
    reanalyzeAllButton.disabled = false;
    await loadPlaces();
  }
  const summary = [
    stopped ? `分析了 ${done} 家後停止（${stopped.message}）` : `分析完成，${named} 家已補上或修正店家資料`,
    notLocated && `其中 ${notLocated} 家沒能自動定位，在「沒定位」裡，請點開按「📍 定位」選擇正確的店`,
  ].filter(Boolean).join('；');
  alert(summary);
});

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
  openDialog(visitDialog);
  try {
    const visits = await api('GET', null, `?place=${place.id}`, '/api/visits');
    others.replaceChildren(...visits.filter((v) => !v.is_mine).map((v) => {
      const item = document.createElement('li');
      const verdict = v.rating ? `${v.rating} 分` : '吃過';
      const note = v.note ? `，${v.note}` : '';
      item.textContent = `${v.name || v.email.split('@')[0]}：${verdict}${note}`;
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

// Tags are mostly Chinese; plain sort() orders by code unit, which looks random to people.
const byChineseOrder = (a, b) => a.localeCompare(b, 'zh-Hant');

function renderChips() {
  const modes = [['all', '全部'], ['todo', '未吃'], ['visited', '吃過'], ['starred', '★ 想吃']];
  if (state.myPosition) modes.splice(1, 0, ...NEAR_RADII_KM.map((km) => ['near', `📍 ${km} 公里`, km]));
  for (const [mode, { label, test }] of Object.entries(PLACE_ISSUES)) {
    const count = state.places.filter((place) => test(place)).length;
    if (count) modes.push([mode, `${label} ${count}`]);
  }
  const tags = [...new Set(state.places.flatMap(tagsOf))].sort(byChineseOrder);
  // The list and the map share one filter, so both rows show the same chips.
  for (const container of [filterChips, $('map-chips')]) {
    container.replaceChildren(
      ...modes.map(([mode, label, radius]) => chip(label, state.filter.mode === mode && state.filter.radius === radius, () => {
        state.filter.mode = mode;
        state.filter.radius = radius;
        renderPlaces();
        fitToRadius();
      })),
      ...tags.map((tag) => chip(`#${tag}`, state.filter.tag === tag, () => { state.filter.tag = state.filter.tag === tag ? null : tag; renderPlaces(); })),
    );
  }
}

function renderPlaces() {
  renderRandomTags();
  renderChips();
  const shown = state.places.filter(matchesFilter);
  if (state.filter.mode === 'near') shown.sort((a, b) => distanceTo(a) - distanceTo(b));
  renderMarkers();
  refreshMapCard();
  refreshRandomPick();
  placeList.className = layout === 'grid' ? 'place-grid' : 'place-rows';
  for (const button of document.querySelectorAll('.layout-toggle button')) {
    button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  }
  placeList.replaceChildren(...shown.map((place) => renderListItem(place, layout)));
  const waitingForAi = state.places.filter(canReanalyze).length;
  reanalyzeAllButton.hidden = !waitingForAi;
  if (!reanalyzeAllButton.disabled) reanalyzeAllButton.textContent = `✨ 沒店名或疑似亂碼的 ${waitingForAi} 家全部 AI 重新分析`;
  if (shown.length) listMessage.textContent = '';
  else if (!state.places.length) listMessage.textContent = '還沒有收藏，按下方＋新增一家吧';
  else listMessage.textContent = searchInput.value.trim() ? '找不到符合的店' : '沒有符合篩選的店';
}

let placesLoad = 0;
async function loadPlaces({ markRead = false } = {}) {
  if (!state.currentListId) return;
  // Switching lists while a load is in flight: only the newest answer may be drawn,
  // or an older list's shops would show (and be edited) under the newly chosen list.
  const thisLoad = ++placesLoad;
  listMessage.textContent = '載入中…';
  try {
    const loaded = await api('GET', null, `?list=${state.currentListId}`);
    if (thisLoad !== placesLoad) return;
    state.places = loaded;
    renderPlaces();
    // Remember this visit so places added afterwards show as "新" next time.
    if (markRead) api('POST', { list_id: state.currentListId }, '', '/api/list-read').catch((error) => console.error('list-read failed', error));
  } catch (error) {
    if (thisLoad === placesLoad) listMessage.textContent = `載入失敗：${error.message}`;
  }
}

for (const button of document.querySelectorAll('.layout-toggle button')) {
  button.addEventListener('click', () => {
    layout = button.dataset.layout;
    saveSetting(LAYOUT_STORAGE_KEY, layout);
    renderPlaces();
  });
}

searchInput.addEventListener('input', () => {
  state.search = searchInput.value.trim().toLowerCase();
  renderPlaces();
});

// ---- The shop card sheet (opened from the list, the map, 今天吃什麼) ----
const mapCard = $('map-card');
let mapCardPlaceId = null;

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
  const place = state.places.find((candidate) => candidate.id === mapCardPlaceId);
  if (place) showMapCard(place);
  else hideMapCard();
}

function focusPlace(place) {
  location.hash = '#map';
  showView(); // switch now (hashchange comes later) so the card isn't closed by the page change
  showMapCard(place);
  panToPlace(place);
}

connectMap({
  showCard: showMapCard,
  hideCard: hideMapCard,
  focusPlace,
  // Switch now (hashchange comes later) so the map starts and can be awaited.
  openMapView() {
    location.hash = '#map';
    showView();
  },
  onFirstPosition: renderPlaces,
  reloadPlaces: loadPlaces,
});

// ---- 今天吃什麼 ----
const randomTag = $('random-tag');
const randomMessage = $('random-message');
let randomPick = null;

function renderRandomTags() {
  const chosen = randomTag.value;
  const tags = [...new Set(state.places.flatMap(tagsOf))].sort(byChineseOrder);
  randomTag.replaceChildren(new Option('全部', ''), ...tags.map((tag) => new Option(`#${tag}`, tag)));
  randomTag.value = tags.includes(chosen) ? chosen : '';
}

$('random-pick').addEventListener('click', () => {
  const radius = Number($('random-radius').value);
  const includeVisited = $('random-include-visited').checked;
  let candidates = state.places.filter((place) => place.name && (includeVisited || !place.my_visited_at) && (!randomTag.value || tagsOf(place).includes(randomTag.value)));
  const notes = [];
  if (radius && state.myPosition) candidates = candidates.filter((place) => (distanceTo(place) ?? Infinity) <= radius);
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

// After ★ / 吃過 / a reload the pick is a new object; redraw it so its buttons act on current data.
function refreshRandomPick() {
  if (!randomPick) return;
  randomPick = state.places.find((place) => place.id === randomPick.id) ?? null;
  $('random-result').replaceChildren(...(randomPick ? [renderPlace(randomPick)] : []));
  $('random-on-map').hidden = !randomPick || !isLocated(randomPick);
}

$('random-on-map').addEventListener('click', () => {
  if (randomPick) focusPlace(randomPick);
});

// ---- Lists and "我的" ----
function selectList(listId) {
  const list = state.lists.find((candidate) => candidate.id === listId) ?? state.lists[0];
  state.currentListId = list.id;
  listSelect.value = String(list.id);
  $('members-link').hidden = Boolean(list.is_personal);
  $('members-link').href = `#members?list=${list.id}`;
  $('export-link').href = `/api/export?list=${list.id}`;
  state.filter = { mode: 'all', tag: null };
  saveSetting(LIST_STORAGE_KEY, String(list.id));
}

async function loadLists() {
  state.lists = await api('GET', null, '', '/api/lists');
  listSelect.replaceChildren(...state.lists.map((list) => new Option(`${list.is_personal ? '👤' : '👥'} ${list.name}`, list.id)));
  selectList(Number(readSetting(LIST_STORAGE_KEY)));
}

function switchToList(listId) {
  selectList(listId);
  resetForm();
  hideMapCard();
  resetMapForNewList();
  void loadPlaces({ markRead: true }); // shows its own error in the list
}

listSelect.addEventListener('change', () => switchToList(Number(listSelect.value)));

// ---- Starting a group ----
const groupDialog = $('group-dialog');
const groupForm = $('group-form');

$('new-group').addEventListener('click', () => {
  groupForm.reset();
  $('group-message').textContent = '';
  groupDialog.showModal();
});

groupForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'create') return;
  event.preventDefault(); // keep the dialog open until the group exists
  const name = groupForm.elements.name.value.trim();
  if (!name) {
    $('group-message').textContent = '請輸入群組名稱';
    return;
  }
  try {
    const group = await api('POST', { name }, '', '/api/lists');
    groupDialog.close();
    await loadLists();
    switchToList(group.id);
  } catch (error) {
    $('group-message').textContent = error.message;
  }
});

// members.js fires this after someone leaves a group, so the list menu drops it.
window.addEventListener('foodmap:pin-style-changed', () => renderMarkers());
// add-form.js (and map.js) fire this after saving, so the list shows the change.
window.addEventListener('foodmap:places-changed', () => loadPlaces());

window.addEventListener('foodmap:lists-changed', async () => {
  try {
    await loadLists();
    switchToList(state.currentListId);
  } catch (error) {
    listMessage.textContent = `清單更新失敗，請重新整理：${error.message}`;
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error('Service worker registration failed', error));
}

// An invite link (/?join=CODE) adds this person to the group. The code is in the query rather than the
// #hash because the hash is more likely to be dropped along the sign-in redirects.
async function acceptInvite() {
  const code = new URLSearchParams(location.search).get('join');
  if (!code) return null;
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  try {
    return await api('POST', { code }, '', '/api/join');
  } catch (error) {
    alert(error.message);
    return null;
  }
}

prefillFromShare();
watchMyPosition();
showView();
try {
  const joined = await acceptInvite();
  await loadLists();
  if (joined) {
    switchToList(joined.list_id);
    location.hash = '#list';
    alert(joined.already_member ? `你已經在「${joined.list_name}」裡了` : `已加入「${joined.list_name}」！`);
  } else {
    await loadPlaces({ markRead: true });
  }
} catch (error) {
  listMessage.textContent = `載入清單失敗：${error.message}`;
}
