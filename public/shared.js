// Small helpers the app's page scripts share.

export const $ = (id) => document.getElementById(id);

export async function api(method, body, query = '', path = '/api/places') {
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

// Remembered choices (last list, layout, pin style) are a convenience; storage can be blocked
// (private mode), so failures just fall back.
export function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering the choice is fine.
  }
}

// Esc keeps the dialog's previous returnValue, so without this it would redo the last choice
// (e.g. delete this shop's 吃過 because another shop's dialog was last closed with 取消吃過).
export function openDialog(dialog) {
  dialog.returnValue = '';
  dialog.showModal();
}

/** Tells the rest of the app that something changed; app.js listens for `foodmap:<name>`. */
export const notify = (name, detail) => window.dispatchEvent(new CustomEvent(`foodmap:${name}`, { detail }));
