// sw.js - Offline Service Worker Cache
const CACHE_NAME = 'silentbridge-v2';
const ASSETS = [
  './index.html',
  './crc16.js',
  './packetEngine.js',
  './audioModem.js',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});