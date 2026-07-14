// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
const CACHE = 'fugui-v1';
const ASSETS = ['/','index.html','css/app.css','js/app.js','js/lib/index.js','js/lib/types.js','js/lib/storage.js','js/lib/clarify.js','js/lib/parser.js','js/lib/query.js','js/lib/query-time.js','js/lib/intent-router.js','js/lib/price-compare.js','js/lib/synonyms.js','manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(r => { const clone = r.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return r; })
    .catch(() => caches.match(e.request))
  );
});

// Pending sync queue for offline records
let syncQueue = [];
self.addEventListener('message', e => {
  if (e.data.type === 'sync-record') { syncQueue.push(e.data.record); }
});
self.addEventListener('sync', e => {
  if (e.tag === 'fugui-sync') {
    e.waitUntil(Promise.all(syncQueue.splice(0).map(r => fetch('/api/record', { method: 'POST', body: JSON.stringify(r) }))));
  }
});
