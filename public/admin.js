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

const lineGroupList = document.getElementById('line-group-list');

function renderLineGroups(lineGroups, groupLists) {
  if (lineGroups.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'meta';
    empty.textContent = '還沒有群組。把 Bot 拉進 LINE 群組並在群組裡發一則訊息後，重新整理這頁。';
    lineGroupList.replaceChildren(empty);
    return;
  }
  lineGroupList.replaceChildren(...lineGroups.map((group) => {
    const lastSeen = group.last_message_at ? `最後訊息 ${group.last_message_at}` : `加入於 ${group.first_seen_at}`;
    const { item, actions } = card(`LINE 群組 …${group.group_id.slice(-6)}`, `${group.list_name ? `收進「${group.list_name}」` : '未綁定（不收連結）'} · ${lastSeen} (UTC)`);
    const select = document.createElement('select');
    select.setAttribute('aria-label', '綁定到清單');
    select.append(new Option('不收連結', ''), ...groupLists.map((list) => new Option(`收進「${list.name}」`, list.id)));
    select.value = group.list_id ? String(group.list_id) : '';
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api('/api/line-groups', 'PATCH', { group_id: group.group_id, list_id: select.value ? Number(select.value) : null });
        await load();
      } catch (error) {
        message.textContent = `綁定失敗：${error.message}`;
        select.disabled = false;
      }
    });
    actions.append(select);
    return item;
  }));
}

async function load() {
  const me = await api('/api/me');
  if (!me.isAdmin) {
    message.textContent = '只有網站管理員可以使用這個頁面。';
    createGroupForm.hidden = true;
    return;
  }
  const [users, lists, lineGroups] = await Promise.all([api('/api/users'), api('/api/lists'), api('/api/line-groups')]);
  renderLineGroups(lineGroups, lists.filter((list) => !list.is_personal));
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

// ---- API usage ----
const SVG = 'http://www.w3.org/2000/svg';
const NEAR_LIMIT = 0.8;
const formatNumber = (number) => number.toLocaleString('zh-TW');

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

// One bar per day for the last 30 days; today is the last bar. Hover/long-press shows the exact count.
function usageChart(history) {
  const width = 300;
  const height = 64;
  const barWidth = width / history.length;
  const highest = Math.max(1, ...history.map((entry) => entry.count));
  const chart = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, class: 'usage-chart', role: 'img', 'aria-label': '近 30 天每日用量' });
  history.forEach((entry, index) => {
    const barHeight = entry.count ? Math.max(2, (entry.count / highest) * height) : 0;
    const bar = svgElement('rect', { x: index * barWidth + 1, y: height - barHeight, width: barWidth - 2, height: barHeight, rx: 1 });
    if (index === history.length - 1) bar.classList.add('today');
    const title = svgElement('title', {});
    title.textContent = `${entry.day}：${formatNumber(entry.count)} 次`;
    bar.append(title);
    chart.append(bar);
  });
  return { chart, highest };
}

function renderUsage(entry) {
  const item = document.createElement('section');
  item.className = 'usage place';
  const title = document.createElement('h3');
  title.textContent = entry.label;

  const remaining = Math.max(0, entry.daily_limit - entry.today);
  const ratio = Math.min(1, entry.today / entry.daily_limit);
  const today = document.createElement('p');
  today.textContent = `今日 ${formatNumber(entry.today)} / ${formatNumber(entry.daily_limit)}，剩 ${formatNumber(remaining)} 次`;
  const bar = document.createElement('div');
  bar.className = 'usage-bar';
  bar.classList.toggle('near-limit', ratio >= NEAR_LIMIT);
  const fill = document.createElement('span');
  fill.style.width = `${ratio * 100}%`;
  bar.append(fill);

  const month = document.createElement('p');
  month.className = 'meta';
  month.textContent = entry.monthly_free
    ? `本月 ${formatNumber(entry.month)} / 免費 ${formatNumber(entry.monthly_free)} 次（剩 ${formatNumber(Math.max(0, entry.monthly_free - entry.month))}）`
    : `本月 ${formatNumber(entry.month)} 次（每日免費額度，不按月計）`;

  const { chart, highest } = usageChart(entry.history);
  const axis = document.createElement('p');
  axis.className = 'meta usage-axis';
  axis.textContent = `近 30 天（單日最高 ${formatNumber(highest)} 次）`;
  item.append(title, today, bar, month, chart, axis);
  return item;
}

async function loadUsage() {
  const usage = await api('/api/usage');
  document.getElementById('usage-list').replaceChildren(...usage.map(renderUsage));
}

load().catch((error) => { message.textContent = `載入失敗：${error.message}`; });
loadUsage().catch((error) => { message.textContent = `用量載入失敗：${error.message}`; });
