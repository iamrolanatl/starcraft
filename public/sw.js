// Minimal service worker for installability + offline shell. Never caches API responses or user data.
const C = "crystal-shell-v4";
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(["/", "/app/", "/manifest.webmanifest"])).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", e => { const u = new URL(e.request.url); if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => caches.match(u.pathname.endsWith("/") ? u.pathname : u.pathname + "/").then(r => r || caches.match("/")))); });
