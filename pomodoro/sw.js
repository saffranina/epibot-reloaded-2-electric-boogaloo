// Service worker: guarda la app en caché para que funcione sin conexión.
const CACHE = 'foco-v7';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './fonts/fredoka.woff2',
  './fonts/cherry-bomb-one.woff2',
  './img/duo-beso.webp',
  './img/duo-cafe.webp',
  './img/duo-corazon.webp',
  './img/duo-escriben.webp',
  './img/duo-leen.webp',
  './img/rubio-parado.webp',
  './img/rubio-camina.webp',
  './img/rubio-sentado.webp',
  './img/rubio-guino.webp',
  './img/rubio-dormido.webp',
  './img/rubio-enojado.webp',
  './img/rojo-parado.webp',
  './img/rojo-camina.webp',
  './img/rojo-sentado.webp',
  './img/rojo-guino.webp',
  './img/rojo-dormido.webp',
  './img/rojo-enojado.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Red primero (para recibir actualizaciones), caché si no hay conexión.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

// Notificación enviada por el servidor de Foco (push-server/).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Foco', {
    body: data.body || '¡Se acabó el tiempo!',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'foco',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) =>
      clients.length ? clients[0].focus() : self.clients.openWindow('./')
    )
  );
});
