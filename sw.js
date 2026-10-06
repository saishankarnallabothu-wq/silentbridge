// sw.js - Offline Service Worker Cache
const CACHE_NAME = 'silentbridge-v6';
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

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((networkRes) => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const toCache = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, toCache));
        }
        return networkRes;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});