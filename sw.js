self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('chat-app-v2').then((cache) => cache.addAll([
      '/',
      '/index.html',
      '/style.css',
      '/manifest.json'
    ]))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // Bypass cache for HTML to get fresh updates
      if (e.request.url.includes('.html') || e.request.mode === 'navigate') {
        return fetch(e.request);
      }
      return response || fetch(e.request);
    })
  );
});