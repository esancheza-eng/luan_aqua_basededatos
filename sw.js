/* Service Worker de Luan Aqua — guarda copia de la app (HTML, manifest, logo, íconos)
   para que abra aunque el celular no tenga nada de internet. Los datos (pedidos, pagos,
   gastos) NO pasan por aquí — eso ya lo maneja la persistencia offline nativa de
   Firestore (db.enablePersistence en index.html). Este archivo solo se encarga de que
   la página misma cargue sin conexión. */

const CACHE_NAME = 'luan-aqua-shell-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo-luanaqua.png',
  './icons/launchericon-48x48.png',
  './icons/launchericon-72x72.png',
  './icons/launchericon-96x96.png',
  './icons/launchericon-144x144.png',
  './icons/launchericon-192x192.png',
  './icons/launchericon-512x512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => {}) // si un ícono falla al cachear, no debe tumbar la instalación
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Estrategia: intenta la red primero (para tener siempre la versión más nueva cuando
   hay internet); si la red falla o no hay conexión, sirve la copia guardada. Solo se
   aplica a peticiones del propio sitio (GET, mismo origen) — todo lo de Firebase/APIs
   externas pasa directo a la red sin tocarlo, para no interferir con la sincronización
   en tiempo real. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const copia = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('./index.html'))
      )
  );
});
