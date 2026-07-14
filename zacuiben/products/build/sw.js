// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
const CACHE='zacuiben-v1';
const ASSETS=['/','index.html','css/app.css','js/app.js','js/lib/index.js','js/lib/types.js','js/lib/storage.js','js/lib/session.js','js/lib/protector.js','js/lib/scheduler.js','manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));return r}).catch(()=>caches.match(e.request)))});
