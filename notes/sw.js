'use strict';

/* 2026-11-09：改成「静态资源缓存优先 + 后台更新」，重复打开几乎瞬时；
   HTML 仍走网络优先，保证新版本立刻生效。
   注意：office-preview 不再预缓存（改成按需加载，省 785KB）。 */
const VERSION = '20261109h';
const CACHE = 'xy6300-notes-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=' + VERSION,
  './core.js?v=' + VERSION,
  './crypto.js?v=' + VERSION,
  './db.js?v=' + VERSION,
  './sync.js?v=' + VERSION,
  './config.js?v=' + VERSION,
  './oss.js?v=' + VERSION,
  './live-editor.bundle.js?v=' + VERSION,
  './app.js?v=' + VERSION,
  './manifest.webmanifest',
  './icon-192.jpg',
  './icon-512.jpg',
  '../assets/xy-hand.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(() => {}));
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // 页面：先网络（拿新版本），断网再用缓存
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源：先给缓存（瞬时），同时在后台更新一份
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
