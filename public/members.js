let listId = 0;
const message = document.getElementById('members-message');
const memberList = document.getElementById('member-list');
const addForm = document.getElementById('add-member-form');
let me;

async function api(method, body, query = '', path = '/api/list-members') {
  const response = await fetch(`${path}${query}`, {
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
  // Adding by email (and handing out ownership) is for site admins; owners use the invite links below.
  addForm.hidden = !(canManage && me.isAdmin);
  message.textContent = `${members.length} 位成員${canManage ? '' : '（只有擁有者能管理成員）'}`;
  memberList.replaceChildren(...members.map((member) => renderMember(member, canManage)));
  // Owners can't leave (a group must keep its owner); everyone else can.
  const mine = members.find((member) => member.user_id === me.id);
  leaveButton.hidden = !mine || Boolean(mine.is_owner);
  lineSection.hidden = !canManage;
  inviteSection.hidden = !canManage;
  bindInstructions.hidden = true;
  newInvite.hidden = true;
  groupName = list.name;
  if (canManage) await Promise.all([loadLineGroups(), loadInvites()]);
}

// ---- Invite links (one person each, 7 days; see functions/api/invites.js) ----
const inviteSection = document.getElementById('invite-section');
const inviteList = document.getElementById('invite-list');
const newInvite = document.getElementById('new-invite');
const inviteUrl = document.getElementById('invite-url');
let groupName = '';

async function loadInvites() {
  const active = await api('GET', null, `?list=${listId}`, '/api/invites');
  inviteList.replaceChildren(...active.map((invite) => {
    const item = document.createElement('li');
    item.className = 'place';
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `還沒用的邀請連結 · 產生於 ${invite.created_at}，到期 ${invite.expires_at} (UTC)`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'secondary';
    revoke.textContent = '作廢';
    revoke.addEventListener('click', async () => {
      try {
        await api('DELETE', { id: invite.id }, '', '/api/invites');
        await loadInvites();
      } catch (error) {
        message.textContent = `作廢失敗：${error.message}`;
      }
    });
    actions.append(revoke);
    item.append(meta, actions);
    return item;
  }));
}

document.getElementById('make-invite').addEventListener('click', async () => {
  try {
    const { code } = await api('POST', { list_id: listId }, '', '/api/invites');
    inviteUrl.value = `${location.origin}/?join=${code}`;
    newInvite.hidden = false;
    await loadInvites();
  } catch (error) {
    message.textContent = `產生邀請連結失敗：${error.message}`;
  }
});

document.getElementById('share-invite').addEventListener('click', async () => {
  const text = `邀請你加入美食地圖的「${groupName}」，點開連結登入就會自動加入（7 天內有效）：`;
  try {
    if (navigator.share) await navigator.share({ title: '美食地圖邀請', text, url: inviteUrl.value });
    else await copyInvite(`${text}\n${inviteUrl.value}`);
  } catch (error) {
    if (error.name !== 'AbortError') message.textContent = `分享失敗：${error.message}`;
  }
});

async function copyInvite(text = inviteUrl.value) {
  await navigator.clipboard.writeText(text);
  message.textContent = '已複製邀請連結，可以貼到 LINE 了';
}

document.getElementById('copy-invite').addEventListener('click', () => {
  copyInvite().catch(() => {
    inviteUrl.select();
    message.textContent = '請長按連結手動複製';
  });
});

// ---- LINE groups feeding this list (owners bind them with a one-time code) ----
const lineSection = document.getElementById('line-bind');
const boundList = document.getElementById('bound-line-groups');
const bindInstructions = document.getElementById('bind-instructions');

async function loadLineGroups() {
  const groups = await api('GET', null, `?list=${listId}`, '/api/line-groups');
  if (!groups.length) {
    const empty = document.createElement('li');
    empty.className = 'meta';
    empty.textContent = '還沒有連結 LINE 群組';
    boundList.replaceChildren(empty);
    return;
  }
  boundList.replaceChildren(...groups.map((group) => {
    const item = document.createElement('li');
    item.className = 'place';
    const title = document.createElement('h2');
    title.textContent = `LINE 群組 …${group.group_id.slice(-6)}`;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = group.last_message_at ? `最後訊息 ${group.last_message_at} (UTC)` : `加入於 ${group.first_seen_at} (UTC)`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const unbind = document.createElement('button');
    unbind.type = 'button';
    unbind.className = 'secondary';
    unbind.textContent = '解除連結';
    unbind.addEventListener('click', async () => {
      if (!confirm('解除後，這個 LINE 群組的連結就不會再收進來。確定？')) return;
      try {
        await api('PATCH', { group_id: group.group_id, list_id: null }, '', '/api/line-groups');
        await loadLineGroups();
      } catch (error) {
        message.textContent = `解除失敗：${error.message}`;
      }
    });
    actions.append(unbind);
    item.append(title, meta, actions);
    return item;
  }));
}

document.getElementById('make-bind-code').addEventListener('click', async () => {
  try {
    const { code, add_friend_url: addFriendUrl } = await api('POST', { list_id: listId }, '', '/api/line-bind-code');
    document.getElementById('bind-text').textContent = `綁定 ${code}`;
    const addFriend = document.getElementById('add-friend-link');
    addFriend.hidden = !addFriendUrl;
    if (addFriendUrl) addFriend.href = addFriendUrl;
    bindInstructions.hidden = false;
  } catch (error) {
    message.textContent = `產生綁定碼失敗：${error.message}`;
  }
});

document.getElementById('refresh-line-groups').addEventListener('click', () => {
  loadLineGroups().catch((error) => { message.textContent = `載入失敗：${error.message}`; });
});

const leaveButton = document.getElementById('leave-group');
leaveButton.addEventListener('click', async () => {
  if (!confirm('確定退出這個群組？之後要請擁有者重新邀請才能回來。')) return;
  leaveButton.disabled = true;
  try {
    await api('DELETE', { list_id: listId, user_id: me.id });
    window.dispatchEvent(new Event('foodmap:lists-changed'));
    location.hash = '#list';
  } catch (error) {
    message.textContent = `退出失敗：${error.message}`;
  } finally {
    leaveButton.disabled = false;
  }
});

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

/** Shows one group's members; called by app.js each time the members tab opens. */
export function showMembers(groupListId) {
  listId = groupListId;
  message.textContent = '載入中…';
  memberList.replaceChildren();
  load().catch((error) => { message.textContent = `載入失敗：${error.message}`; });
}
