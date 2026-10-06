// sw.js - Offline Service Worker Cache
const CACHE_NAME = 'silentbridge-v3';
const ASSETS = [
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
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});