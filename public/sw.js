/* ============================================================
   ODGJ STREET COFFEE — Service Worker v3 (PWA E-Menu)
   Cache aset + runtime cache menu API + offline fallback + BG Sync
   ============================================================ */

const CACHE = 'odgj-v3';
const ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const OFFLINE_DB = 'odgj-offline';
const OFFLINE_STORE = 'pending-orders';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Strategi: network-first + cache fallback untuk /api/menu (E-Menu offline),
// network-only dgn JSON offline utk API lain, cache-first utk aset statis.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (url.pathname === '/api/menu' || url.pathname.startsWith('/api/menu?')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((c) => c || offlineJson()))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => offlineJson())
    );
    return;
  }

  // Navigasi halaman → fallback offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && url.origin === location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match('./offline.html').then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (res.ok && url.origin === location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

function offlineJson() {
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ===== Background Sync untuk order offline =====
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  }
});

async function syncPendingOrders() {
  const orders = await getPendingOrders();
  if (orders.length === 0) return;

  for (const order of orders) {
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order.payload)
      });

      if (response.ok) {
        await removePendingOrder(order.id);
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: 'ORDER_SYNCED',
            orderId: order.payloadId,
            serverOrderId: (response.clone ? null : null),
          });
        });
      } else if (response.status === 422) {
        await removePendingOrder(order.id);
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({ type: 'ORDER_FAILED', orderId: order.payloadId, error: 'Item tidak tersedia' });
        });
      }
    } catch (err) {
      console.log('[SW] Sync failed for order:', order.payloadId, err.message);
    }
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPendingOrders() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const request = tx.objectStore(OFFLINE_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addPendingOrder(payload, payloadId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    const request = tx.objectStore(OFFLINE_STORE).add({ payload, payloadId, createdAt: Date.now(), retries: 0 });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removePendingOrder(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    const request = tx.objectStore(OFFLINE_STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'QUEUE_ORDER') {
    addPendingOrder(event.data.payload, event.data.payloadId)
      .then(() => self.registration.sync.register('sync-orders'))
      .catch((err) => console.error('[SW] Failed to queue order:', err));
  }
});
