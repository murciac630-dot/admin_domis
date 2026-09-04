const CACHE = "ferco-domis-shell-v31";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css?v=26",
  "./js/app.js?v=26",
  "./js/auth.js",
  "./js/db.js",
  "./js/firebase.js",
  "./js/gps.js",
  "./js/maps.js",
  "./js/upgrades.js?v=26",
  "./js/admin_services.js?v=3",
  "./js/admin_cleanup.js?v=2",
  "./js/nomina_turnos.js?v=2",
  "./js/dashboard_active.js?v=1",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy));
    return response;
  }).catch(() => caches.match("./index.html")));
});
