// sw.js - Offline Service Worker Cache (Network-First with Instant Updates)
const CACHE_NAME = 'silentbridge-v33';
const ASSETS = [
  './',
  './index.html',
  './crc16.js',
  './packetEngine.js',
  './paho-mqtt.js',
  './meshBridge.js',
  './audioModem.js',
  './app.js',
  './manifest.json'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).then(() => {
        return Promise.allSettled(
          CDN_ASSETS.map((url) =>
            fetch(url, { mode: 'cors' }).then((res) => {
              if (res && res.ok) {
                return cache.put(url, res);
              }
            })
          )
        );
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First: Always attempt to fetch the latest application updates from the server.
// Fallback to offline cache ONLY when completely disconnected from network.
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const toCache = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, toCache));
        }
        return networkRes;
      })
      .catch(() => {
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return null;
        });
      })
  );
});