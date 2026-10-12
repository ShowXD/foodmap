const listId = Number(new URLSearchParams(location.search).get('list'));
const message = document.getElementById('members-message');
const memberList = document.getElementById('member-list');
const addForm = document.getElementById('add-member-form');
let me;

async function api(method, body, query = '') {
  const response = await fetch(`/api/list-members${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error === 'list not found' ? '找不到這個群組，或你不是成員' : payload.error || `HTTP ${response.status}`);
  return payload;
}

function renderMember(member, canManage) {
  const item = document.createElement('li');
  item.className = 'place';
  const title = document.createElement('h2');
  title.textContent = member.email + (member.email === me.email ? '（你）' : '');
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = member.is_owner ? '擁有者' : '成員';
  item.append(title, meta);
  // Owners can only be removed by a site admin (the API enforces this too).
  if (canManage && member.email !== me.email && (!member.is_owner || me.isAdmin)) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = '移出群組';
    remove.addEventListener('click', async () => {
      if (!confirm(`確定把 ${member.email} 移出群組？`)) return;
      remove.disabled = true;
      try {
        await api('DELETE', { list_id: listId, user_id: member.user_id });
        await load();
      } catch (error) {
        message.textContent = `移除失敗：${error.message}`;
        remove.disabled = false;
      }
    });
    actions.append(remove);
    item.append(actions);
  }
  return item;
}

async function load() {
  me ??= await fetch('/api/me').then((response) => response.json());
  const { list, members, canManage } = await api('GET', null, `?list=${listId}`);
  document.getElementById('group-title').textContent = `👥 ${list.name}`;
  document.title = `美食地圖・${list.name}`;
  addForm.hidden = !canManage;
  // Only site admins hand out ownership (the API ignores is_owner from anyone else).
  document.getElementById('owner-option').hidden = !me.isAdmin;
  message.textContent = `${members.length} 位成員${canManage ? '' : '（只有擁有者能管理成員）'}`;
  memberList.replaceChildren(...members.map((member) => renderMember(member, canManage)));
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = addForm.querySelector('button');
  button.disabled = true;
  try {
    await api('POST', { list_id: listId, email: addForm.elements.email.value, is_owner: addForm.elements.is_owner.checked });
    addForm.reset();
    await load();
    message.textContent = '已加入';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

load().catch((error) => { message.textContent = `載入失敗：${error.message}`; });
