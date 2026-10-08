// sw.js - Robust Offline Service Worker & Tactical Cache Engine
const CACHE_NAME = 'silentbridge-offline-v14';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './crc16.js',
  './packetEngine.js',
  './paho-mqtt.js',
  './meshBridge.js',
  './audioModem.js',
  './app.js',
  './leaflet.css',
  './leaflet.js',
  './manifest.json',
  './images/marker-icon.png',
  './images/marker-icon-2x.png',
  './images/marker-shadow.png',
  './images/layers.png',
  './images/layers-2x.png'
];

const EXTERNAL_CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&family=JetBrains+Mono:wght@400;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 1. Guarantee pre-caching of all local files
      return cache.addAll(LOCAL_ASSETS).then(() => {
        console.log('✅ SilentBridge ServiceWorker: Local assets successfully cached for 100% offline use.');
        // 2. Opportunistically cache CDN assets without failing install if offline
        return Promise.allSettled(
          EXTERNAL_CDN_ASSETS.map((url) =>
            fetch(url, { mode: 'cors' }).then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                return cache.put(url, res);
              }
            }).catch(() => {
              // Ignore failure if already offline during install
            })
          )
        );
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Navigation request (HTML page reload/open): Return cached index.html if offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('./index.html', { ignoreSearch: true }) || caches.match('./', { ignoreSearch: true });
      })
    );
    return;
  }

  // Assets (scripts, styles, images): Cache-first with ignoreSearch to handle query params like ?v=13
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) {
        return cached;
      }

      // If not in cache, attempt network fetch and cache successful response
      return fetch(event.request).then((networkRes) => {
        if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
          const toCache = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, toCache);
          });
        }
        return networkRes;
      }).catch(() => {
        // Fallback: Try matching without query strings or return index.html for navigation
        const cleanUrl = event.request.url.split('?')[0];
        return caches.match(cleanUrl, { ignoreSearch: true });
      });
    })
  );
});