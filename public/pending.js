fetch('/api/me').then((response) => response.json()).then(({ email, status }) => {
  if (status !== 'disabled') return location.replace('/');
  document.getElementById('status-text').textContent = '這個帳號已被停用，有問題請聯絡網站管理員。';
  document.getElementById('email-text').textContent = `登入帳號：${email}`;
}).catch(() => {
  document.getElementById('status-text').textContent = '讀取帳號狀態失敗，請稍後重新整理。';
});
