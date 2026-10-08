const searchInput = document.getElementById('search');
const placeList = document.getElementById('place-list');
const listMessage = document.getElementById('list-message');
const addForm = document.getElementById('add-form');
const formMessage = document.getElementById('form-message');
const placeTemplate = document.getElementById('place-template');

const mapsUrl = (place) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address || place.area].filter(Boolean).join(' '))}`;

async function api(method, body, query = '') {
  const response = await fetch(`/api/places${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { status: response.status });
  return payload;
}

function renderPlace(place) {
  const card = placeTemplate.content.firstElementChild.cloneNode(true);
  const isVisited = place.status === 'visited';
  card.classList.toggle('visited', isVisited);
  card.querySelector('.name').textContent = place.name || '（未填店名）';
  card.querySelector('.dishes').textContent = place.dishes || '';
  card.querySelector('.meta').textContent = [place.area, place.tags].filter(Boolean).join(' · ');
  card.querySelector('.note').textContent = place.note || '';
  card.querySelector('.video').href = place.url;

  const mapsLink = card.querySelector('.maps');
  if (place.name) mapsLink.href = mapsUrl(place);
  else mapsLink.remove();

  const toggleButton = card.querySelector('.toggle-status');
  toggleButton.textContent = isVisited ? '標為未吃' : '吃過了';
  toggleButton.addEventListener('click', async () => {
    toggleButton.disabled = true;
    try {
      const updated = await api('PATCH', { id: place.id, status: isVisited ? 'todo' : 'visited' });
      card.replaceWith(renderPlace(updated));
    } catch (error) {
      toggleButton.disabled = false;
      alert(`更新失敗：${error.message}`);
    }
  });
  card.querySelector('.edit').addEventListener('click', () => startEdit(place));
  return card;
}

const EDIT_FIELDS = ['name', 'dishes', 'area', 'address', 'tags', 'caption', 'note'];
const addPanel = document.getElementById('add-panel');
const cancelEditButton = document.getElementById('cancel-edit');

function startEdit(place) {
  for (const field of EDIT_FIELDS) addForm.elements[field].value = place[field] ?? '';
  addForm.elements.url.value = place.url;
  addForm.elements.url.readOnly = true;
  addForm.elements.id.value = place.id;
  addForm.querySelector('button[type="submit"]').textContent = '更新';
  addPanel.querySelector('summary').textContent = '編輯店家';
  cancelEditButton.hidden = false;
  formMessage.textContent = '';
  addPanel.open = true;
  addPanel.scrollIntoView({ behavior: 'smooth' });
}

// Hidden inputs keep values set by script across reset(), so restore them explicitly.
function resetForm() {
  addForm.reset();
  addForm.elements.source.value = 'manual';
  addForm.elements.id.value = '';
  addForm.elements.url.readOnly = false;
  addForm.querySelector('button[type="submit"]').textContent = '儲存';
  addPanel.querySelector('summary').textContent = '＋ 新增一家店';
  cancelEditButton.hidden = true;
}

cancelEditButton.addEventListener('click', () => {
  resetForm();
  formMessage.textContent = '';
  addPanel.open = false;
});

async function loadPlaces() {
  const query = searchInput.value.trim();
  listMessage.textContent = '載入中…';
  try {
    const places = await api('GET', null, query ? `?q=${encodeURIComponent(query)}` : '');
    placeList.replaceChildren(...places.map(renderPlace));
    listMessage.textContent = places.length ? '' : (query ? '找不到符合的店' : '還沒有收藏，先新增一家吧');
  } catch (error) {
    listMessage.textContent = `載入失敗：${error.message}`;
  }
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadPlaces, 300);
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
    else await api('POST', formFields);
    resetForm();
    formMessage.textContent = editingId ? '已更新' : '已儲存';
    loadPlaces();
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
  document.getElementById('add-panel').open = true;
  history.replaceState(null, '', location.pathname);
}

prefillFromShare();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error('Service worker registration failed', error));
}

loadPlaces();
