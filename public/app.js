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

const VIEWS = ['map', 'list', 'add', 'me'];
const LIST_STORAGE_KEY = 'foodmap.list';
const EDIT_FIELDS = ['name', 'dishes', 'area', 'address', 'tags', 'caption', 'note'];

let lists = [];
let currentListId = null;
let places = [];
let filter = { mode: 'all', tag: null };

const mapsUrl = (place) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address || place.area].filter(Boolean).join(' '))}`;
// Places saved from LINE with only a link have no name yet and need tidying.
const needsTidying = (place) => !place.name;
const tagsOf = (place) => String(place.tags ?? '').split(/\s+/).filter(Boolean);

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
function showView() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'map';
  document.body.dataset.view = view;
  for (const tab of document.querySelectorAll('.tabbar a')) {
    tab.toggleAttribute('aria-current', tab.dataset.tab === view);
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showView);

// ---- Place cards ----
function familySummary(place) {
  const parts = [];
  if (place.visit_count) parts.push(`${place.visit_count} 人吃過`);
  if (place.avg_rating) parts.push(`平均 ${place.avg_rating} 分`);
  return parts.join(' · ');
}

function renderPlace(place) {
  const card = placeTemplate.content.firstElementChild.cloneNode(true);
  const isVisited = Boolean(place.my_visited_at);
  card.classList.toggle('visited', isVisited);
  card.querySelector('.name').textContent = place.name || '（待整理：還沒有店名）';
  card.querySelector('.badge-new').hidden = !place.is_new;
  card.querySelector('.dishes').textContent = place.dishes || '';
  card.querySelector('.meta').textContent = [place.area, place.tags, place.source === 'line' ? '來自 LINE' : ''].filter(Boolean).join(' · ');
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
      item.textContent = `${v.email.split('@')[0]}：${v.rating ? `${v.rating} 分` : '吃過'}${v.note ? `，${v.note}` : ''}`;
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
  if (filter.tag && !tagsOf(place).includes(filter.tag)) return false;
  return true;
}

function renderChips() {
  const untidy = places.filter(needsTidying).length;
  const modes = [['all', '全部'], ['todo', '未吃'], ['visited', '吃過'], ['starred', '★ 想吃']];
  if (untidy) modes.push(['untidy', `待整理 ${untidy}`]);
  const tags = [...new Set(places.flatMap(tagsOf))].sort();
  filterChips.replaceChildren(
    ...modes.map(([mode, label]) => chip(label, filter.mode === mode, () => { filter.mode = mode; renderPlaces(); })),
    ...tags.map((tag) => chip(`#${tag}`, filter.tag === tag, () => { filter.tag = filter.tag === tag ? null : tag; renderPlaces(); })),
  );
}

function renderPlaces() {
  renderChips();
  const shown = places.filter(matchesFilter);
  placeList.replaceChildren(...shown.map(renderPlace));
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

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadPlaces, 300);
});

// ---- 今天吃什麼 ----
$('random-pick').addEventListener('click', () => {
  const candidates = places.filter((place) => place.name && !place.my_visited_at);
  const result = $('random-result');
  if (!candidates.length) {
    result.replaceChildren();
    alert('這份清單裡沒有還沒吃過的店了');
    return;
  }
  result.replaceChildren(renderPlace(candidates[Math.floor(Math.random() * candidates.length)]));
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
  $('current-list-name').textContent = `${list.is_personal ? '👤' : '👥'} ${list.name}`;
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
  $('random-result').replaceChildren();
  loadPlaces({ markRead: true });
});

api('GET', null, '', '/api/me')
  .then((me) => {
    $('user-email').textContent = me.email;
    $('admin-link').hidden = !me.isAdmin;
  })
  .catch((error) => console.error('Failed to load current user', error));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error('Service worker registration failed', error));
}

prefillFromShare();
showView();
loadLists()
  .then(() => loadPlaces({ markRead: true }))
  .catch((error) => {
    listMessage.textContent = `載入清單失敗：${error.message}`;
  });
