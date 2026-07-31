const CACHE_NAME = 'luanaqua-cache-v1';
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzKcilhv6mJf61EnC1Plows6sPd1DIgirpNoSE5KG751k8LW89l0b8HkTvSot07i9F4/exec";
const DB_NAME = 'aqualuan-db', STORE = 'pedidos-pendientes';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

function abrirDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function obtenerPendientes() {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function eliminarLocal(id) {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => res();
    req.onerror = e => rej(e.target.error);
  });
}

async function sincronizarPedidosPendientes() {
  const items = await obtenerPendientes().catch(() => []);
  if (!items.length) return;
  let synced = 0;
  for (const item of items) {
    try {
      await fetch(SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (item.id) await eliminarLocal(item.id).catch(() => {});
      synced++;
    } catch { /* se reintenta en el próximo evento sync */ }
  }
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SYNC_DONE', synced }));
}

self.addEventListener('sync', event => {
  if (event.tag === 'sync-pedidos') event.waitUntil(sincronizarPedidosPendientes());
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'FORCE_SYNC') sincronizarPedidosPendientes();
});
