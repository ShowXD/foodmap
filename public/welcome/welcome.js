// Invite links point here (/welcome/?join=CODE); carry the code on to the app, which accepts it after sign-in.
const code = new URLSearchParams(location.search).get('join');
if (code && /^[0-9a-f]{64}$/.test(code)) {
  document.getElementById('sign-in').href = `/?join=${code}`;
  document.getElementById('invite').hidden = false;
}
