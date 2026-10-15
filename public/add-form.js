// The ＋ page: adding a shop (with AI filling in from the post) and editing one.
import { $, api, notify } from './shared.js';
import { state } from './state.js';

const addForm = $('add-form');
const formMessage = $('form-message');
const EDIT_FIELDS = ['name', 'dishes', 'area', 'address', 'tags', 'caption', 'note'];
const FIELD_LABELS = { name: '店名', dishes: '食物', area: '地區', address: '地址', tags: '標籤' };
const cancelEditButton = $('cancel-edit');
const candidatesPanel = $('ai-candidates');
const candidateList = $('candidate-list');
const saveCandidatesButton = $('save-candidates');
let candidates = [];

export function startEdit(place) {
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
export function resetForm() {
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
// Blanks are filled straight away; anything already typed is only replaced if the person agrees,
// so running AI again can fix a bad earlier result without silently overwriting hand edits.
function fillFromAi(place) {
  const fields = Object.entries(place).filter(([, text]) => text);
  const changed = fields.filter(([field, text]) => {
    const current = addForm.elements[field].value.trim();
    return current && current !== text;
  });
  const shouldReplace = changed.length > 0
    && confirm(`AI 的結果和目前的${changed.map(([field]) => FIELD_LABELS[field]).join('、')}不同，要用 AI 的結果取代嗎？`);
  for (const [field, text] of fields) {
    if (!addForm.elements[field].value.trim() || shouldReplace) addForm.elements[field].value = text;
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
      await api('POST', { ...place, list_id: state.currentListId, url: url.value, caption: caption.value, source: source.value, note: note.value });
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
  notify('places-changed');
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
      fillFromAi(extracted.places[0]);
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
    else await api('POST', { ...formFields, list_id: state.currentListId });
    resetForm();
    formMessage.textContent = editingId ? '已更新' : '已儲存';
    notify('places-changed');
    if (editingId) location.hash = '#list';
  } catch (error) {
    formMessage.textContent = error.status === 409 ? '這個連結已經收藏過了' : `儲存失敗：${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

// Android share target lands here as /?title=&text=&url=; LINE usually puts the link inside `text`.
export function prefillFromShare() {
  const params = new URLSearchParams(location.search);
  const sharedText = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  const sharedUrl = /https?:\/\/\S+/.exec(sharedText)?.[0];
  if (!sharedUrl) return;
  addForm.elements.url.value = sharedUrl;
  addForm.elements.caption.value = sharedText.replaceAll(sharedUrl, '').trim();
  addForm.elements.source.value = 'share';
  history.replaceState(null, '', `${location.pathname}#add`);
}
