const message = document.getElementById('admin-message');
const userList = document.getElementById('user-list');
const groupList = document.getElementById('group-list');
const createGroupForm = document.getElementById('create-group-form');

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function card(titleText, metaText) {
  const item = document.createElement('li');
  item.className = 'place';
  const title = document.createElement('h2');
  title.textContent = titleText;
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = metaText;
  const actions = document.createElement('div');
  actions.className = 'actions';
  item.append(title, meta, actions);
  return { item, actions };
}

function userButton(label, changes, user) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api('/api/users', 'PATCH', { id: user.id, ...changes });
      await load();
    } catch (error) {
      message.textContent = `更新失敗：${error.message}`;
      button.disabled = false;
    }
  });
  return button;
}

async function load() {
  const me = await api('/api/me');
  if (!me.isAdmin) {
    message.textContent = '只有網站管理員可以使用這個頁面。';
    createGroupForm.hidden = true;
    return;
  }
  const [users, lists] = await Promise.all([api('/api/users'), api('/api/lists')]);
  message.textContent = `${users.length} 個帳號、${lists.filter((list) => !list.is_personal).length} 個群組`;

  groupList.replaceChildren(...lists.filter((list) => !list.is_personal).map((list) => {
    const { item, actions } = card(`👥 ${list.name}`, list.is_member ? '你是成員' : '你不是成員（網站管理員仍可管理）');
    const link = document.createElement('a');
    link.href = `/members?list=${list.id}`;
    link.textContent = '管理成員';
    actions.append(link);
    return item;
  }));

  userList.replaceChildren(...users.map((user) => {
    const isMe = user.email === me.email;
    const status = user.status === 'disabled' ? '已停用' : '可使用';
    const { item, actions } = card(user.email + (isMe ? '（你）' : ''), `${status}${user.is_admin ? ' · 網站管理員' : ''} · 首次登入 ${user.created_at} (UTC)`);
    if (!isMe) {
      actions.append(user.status === 'disabled' ? userButton('恢復', { status: 'approved' }, user) : userButton('停用', { status: 'disabled' }, user));
      actions.append(userButton(user.is_admin ? '取消網站管理員' : '設為網站管理員', { is_admin: !user.is_admin }, user));
    }
    return item;
  }));
}

createGroupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = createGroupForm.querySelector('button');
  button.disabled = true;
  try {
    const { name, owner_email: ownerEmail } = Object.fromEntries(new FormData(createGroupForm));
    await api('/api/lists', 'POST', { name, owner_email: ownerEmail });
    createGroupForm.reset();
    await load();
    message.textContent = `已建立群組「${name}」`;
  } catch (error) {
    message.textContent = `建立失敗：${error.message}`;
  } finally {
    button.disabled = false;
  }
});

load().catch((error) => { message.textContent = `載入失敗：${error.message}`; });
