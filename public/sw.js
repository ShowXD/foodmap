// Kept only so the app stays installable. It caches nothing: behind Cloudflare Access a
// cached page can outlive a login change (an old cached login page once got stuck on
// phones), and the app needs the network for its data anyway.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
