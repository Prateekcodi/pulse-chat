self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('chat-app-v3').then((cache) => cache.addAll([
      '/',
      '/index.html',
      '/style.css',
      '/manifest.json'
    ]))
  );
});

self.addEventListener('fetch', (e) => {
  // Bypass cache for JS and HTML to get fresh updates
  if (e.request.url.includes('.js') || e.request.url.includes('.html') || e.request.mode === 'navigate') {
    return fetch(e.request);
  }
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});