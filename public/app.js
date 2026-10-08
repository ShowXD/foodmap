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
  return card;
}

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
  try {
    await api('POST', Object.fromEntries(new FormData(addForm)));
    addForm.reset();
    formMessage.textContent = '已儲存';
    loadPlaces();
  } catch (error) {
    formMessage.textContent = error.status === 409 ? '這個連結已經收藏過了' : `儲存失敗：${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error('Service worker registration failed', error));
}

loadPlaces();
