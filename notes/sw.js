'use strict';

const CACHE = 'xy6300-notes-v13';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=13',
  './core.js?v=13',
  './crypto.js?v=13',
  './db.js?v=13',
  './sync.js?v=13',
  './config.js?v=13',
  './live-editor.bundle.js?v=9',
  './office-preview.bundle.js?v=3',
  './app.js?v=13',
  './manifest.webmanifest',
  './icon-192.jpg',
  './icon-512.jpg',
  '../assets/xy-hand.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
  );
});
