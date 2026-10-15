// 管理標籤 (in the list's ⋯ menu): rename, merge or remove a tag on every place in the current list.
import { $, api, openDialog } from './shared.js';
import { state, tagCounts } from './state.js';

const tagsDialog = $('tags-dialog');
const rows = $('tag-rows');
const message = $('tags-message');
let reloadPlaces = async () => {};

/** `reload` fetches the list again (app.js loadPlaces), so the counts and the page match the server. */
export function connectTags(reload) {
  reloadPlaces = reload;
}

function smallButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderRows() {
  const counts = tagCounts(state.places);
  rows.replaceChildren(...counts.map(([tag, count]) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${tag}（${count} 家）`;
    item.append(name, smallButton('改名', () => rename(tag)), smallButton('刪除', () => remove(tag, count)));
    return item;
  }));
  if (!counts.length) message.textContent = '這份清單還沒有標籤';
}

async function update(from, to) {
  message.textContent = '更新中…';
  try {
    const { updated } = await api('PUT', { list_id: state.currentListId, from, to }, '', '/api/tags');
    await reloadPlaces();
    message.textContent = `已更新 ${updated} 家`;
    renderRows();
  } catch (error) {
    message.textContent = `更新失敗：${error.message}`;
  }
}

function rename(tag) {
  const to = prompt(`把「${tag}」改成什麼？\n輸入已有的標籤會合併成一個。`, tag)?.trim();
  if (to && to !== tag) update(tag, to);
}

function remove(tag, count) {
  if (confirm(`從 ${count} 家店移除「${tag}」這個標籤？`)) update(tag, '');
}

$('manage-tags').addEventListener('click', () => {
  message.textContent = '';
  renderRows();
  openDialog(tagsDialog);
});
