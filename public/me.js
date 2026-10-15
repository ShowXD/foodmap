// 我的: name and photo (also shown on the tab), pin style, and the sign-in methods linked to this account.
import { $, api, notify, openDialog, saveSetting } from './shared.js';
import { PIN_STYLE_KEY, state } from './state.js';

// ---- Profile: name and photo shown on 我的 and on the tab ----
const profileDialog = $('profile-dialog');
const profileForm = $('profile-form');
const MAX_NAME_LENGTH = 30;
const AVATAR_SIZE = 256;
let profile = null;

const displayName = (person) => person.name || person.email.split('@')[0];

function renderAvatar(element, person) {
  // A steady colour per person, so initials are easy to tell apart.
  element.style.setProperty('--avatar-hue', String((person.id * 47) % 360));
  if (person.avatarVersion) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = `/avatar/${person.id}?v=${encodeURIComponent(person.avatarVersion)}`;
    element.replaceChildren(image);
  } else {
    element.textContent = Array.from(displayName(person))[0].toUpperCase();
  }
}

function applyProfile() {
  $('profile-name').textContent = displayName(profile);
  $('user-email').textContent = profile.email;
  $('tab-name').textContent = displayName(profile);
  for (const link of document.querySelectorAll('.admin-only')) link.hidden = !profile.isAdmin;
  renderAvatar($('avatar-button'), profile);
  renderAvatar($('tab-avatar'), profile);
}

// Google sign-ins usually carry the person's name; email-code sign-ins don't, so this may find nothing.
async function nameFromSignIn() {
  try {
    const response = await fetch('/cdn-cgi/access/get-identity');
    if (!response.ok) return null;
    const identity = await response.json();
    return typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim().slice(0, MAX_NAME_LENGTH) : null;
  } catch {
    return null;
  }
}

async function saveName(name) {
  ({ name: profile.name } = await api('PATCH', { display_name: name }, '', '/api/me'));
  applyProfile();
}

// Square-crops and shrinks to a small JPEG in the browser, so uploads stay tiny whatever the phone camera produced.
async function squareJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  canvas.getContext('2d').drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('無法處理這張圖片'))), 'image/jpeg', 0.85);
  });
}

$('avatar-file').addEventListener('change', async () => {
  const file = $('avatar-file').files[0];
  $('avatar-file').value = '';
  if (!file) return;
  try {
    const response = await fetch('/api/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: await squareJpeg(file) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    profile.avatarVersion = payload.avatarVersion;
    applyProfile();
  } catch (error) {
    alert(`更換大頭貼失敗：${error.message}`);
  }
});

const pickAvatar = () => $('avatar-file').click();
$('avatar-button').addEventListener('click', pickAvatar);
$('change-avatar').addEventListener('click', () => {
  profileDialog.close('cancel');
  pickAvatar();
});

$('remove-avatar').addEventListener('click', async () => {
  try {
    ({ avatarVersion: profile.avatarVersion } = await api('DELETE', null, '', '/api/avatar'));
    applyProfile();
    $('remove-avatar').hidden = true;
  } catch (error) {
    alert(`移除失敗：${error.message}`);
  }
});

$('edit-profile').addEventListener('click', () => {
  profileForm.elements.display_name.value = displayName(profile);
  $('remove-avatar').hidden = !profile.avatarVersion;
  openDialog(profileDialog);
});

profileDialog.addEventListener('close', async () => {
  if (profileDialog.returnValue !== 'save') return;
  try {
    await saveName(profileForm.elements.display_name.value);
  } catch (error) {
    alert(`儲存失敗：${error.message}`);
  }
});

// ---- Pin style setting (see pinFor) ----
const pinShapeSelect = $('pin-shape');
const pinSizeSelect = $('pin-size');
const pinShowName = $('pin-show-name');
pinShapeSelect.value = state.pinStyle.shape;
pinSizeSelect.value = state.pinStyle.size;
pinShowName.checked = Boolean(state.pinStyle.showName);

function savePinStyle() {
  state.pinStyle = { shape: pinShapeSelect.value, size: pinSizeSelect.value, showName: pinShowName.checked };
  saveSetting(PIN_STYLE_KEY, JSON.stringify(state.pinStyle));
  notify('pin-style-changed');
}
for (const control of [pinShapeSelect, pinSizeSelect, pinShowName]) control.addEventListener('change', savePinStyle);

// ---- Sign-in methods linked to this account (see lib/links.js) ----
const LINK_RESULTS = {
  linked: '綁定完成！之後用這個登入方式，也會進到同一個帳號。',
  taken: '這個帳號已經有自己的資料，沒辦法綁定。你現在是用它登入的；要合併兩個帳號請聯絡網站管理員。',
  expired: '綁定逾時或已經用過了，請到「我的」重新按一次「綁定其他登入方式」。',
};

async function loadIdentities() {
  const identities = await api('GET', null, '', '/api/link');
  $('identity-list').replaceChildren(...identities.map((identity) => {
    const item = document.createElement('li');
    const email = document.createElement('span');
    email.className = 'identity-email';
    email.textContent = identity.email;
    const tags = document.createElement('span');
    tags.className = 'meta';
    tags.textContent = [identity.is_main && '主要', identity.is_current && '目前使用中'].filter(Boolean).join('・');
    item.append(email, tags);
    if (!identity.is_main && !identity.is_current) {
      const unlink = document.createElement('button');
      unlink.type = 'button';
      unlink.className = 'secondary';
      unlink.textContent = '解除';
      unlink.addEventListener('click', async () => {
        if (!confirm(`解除後，用 ${identity.email} 登入會變成另一個新帳號。確定？`)) return;
        try {
          await api('DELETE', { email: identity.email }, '', '/api/link');
          await loadIdentities();
        } catch (error) {
          alert(`解除失敗：${error.message}`);
        }
      });
      item.append(unlink);
    }
    return item;
  }));
}

$('link-account').addEventListener('click', async () => {
  const steps = '接下來會先登出。\n\n請在登入頁選擇「要綁定的那個帳號」登入（例如 Google），並在 10 分鐘內完成。\n回到美食地圖後就會看到結果。';
  if (!confirm(steps)) return;
  try {
    await api('POST', null, '', '/api/link');
    location.href = '/cdn-cgi/access/logout';
  } catch (error) {
    alert(`無法開始綁定：${error.message}`);
  }
});

// The middleware leaves the outcome in a short-lived cookie after the other account signs in.
function showLinkResult() {
  const outcome = document.cookie.split(/;\s*/).find((pair) => pair.startsWith('foodmap_link_result='))?.split('=')[1];
  if (!outcome) return;
  document.cookie = 'foodmap_link_result=; Path=/; Max-Age=0; Secure; SameSite=Lax';
  location.hash = '#me';
  alert(LINK_RESULTS[outcome] ?? LINK_RESULTS.expired);
}

api('GET', null, '', '/api/me')
  .then(async (me) => {
    profile = me;
    applyProfile();
    showLinkResult();
    loadIdentities().catch((error) => console.error('Failed to load sign-in methods', error));
    if (!profile.name) {
      const name = await nameFromSignIn();
      if (name) await saveName(name);
    }
  })
  .catch((error) => console.error('Failed to load current user', error));
