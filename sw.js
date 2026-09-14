/* Service Worker Aqua Luan — app shell + CDNs críticos para abrir SIN internet.
   Datos (pedidos/pagos/gastos) los maneja Firestore persistence en index.html. */

const CACHE_NAME = 'luan-aqua-shell-v5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo-luanaqua.png',
  './logo-icon.png',
  './icons/launchericon-48x48.png',
  './icons/launchericon-72x72.png',
  './icons/launchericon-96x96.png',
  './icons/launchericon-144x144.png',
  './icons/launchericon-192x192.png',
  './icons/launchericon-512x512.png'
];

const CDN_CRITICOS = [
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-functions-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap'
];

function esCdnCritico(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'www.gstatic.com' ||
      u.hostname === 'cdnjs.cloudflare.com' ||
      u.hostname === 'fonts.googleapis.com' ||
      u.hostname === 'fonts.gstatic.com'
    );
  } catch (e) {
    return false;
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of APP_SHELL) {
      try { await cache.add(url); } catch (e) {}
    }
    for (const url of CDN_CRITICOS) {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res && res.ok) await cache.put(url, res.clone());
      } catch (e) {}
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const mismoOrigen = url.origin === self.location.origin;
  const cdn = esCdnCritico(event.request.url);
  if (!mismoOrigen && !cdn) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);

    if (!navigator.onLine && cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response && response.status === 200 && (mismoOrigen || cdn)) {
        const copia = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia)).catch(() => {});
      }
      return response;
    } catch (err) {
      if (cached) return cached;
      if (mismoOrigen && event.request.mode === 'navigate') {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
      return Response.error();
    }
  })());
});
