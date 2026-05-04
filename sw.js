self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('chat-app-v1').then((cache) => cache.addAll([
      '/',
      '/style.css',
      '/client.js',
      '/manifest.json'
    ]))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});