/* Service worker: precache all assets so the app works with zero signal. */
// Bump VERSION on every deploy. The fetch handler below also stale-while-
// revalidates, so a plain redeploy is picked up on the next launch even if you
// forget — but bumping guarantees the old cache is wiped on activate.
const VERSION = '2026-06-13';
const CACHE = 'poker-tracker-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/dexie.min.js',
  'js/fflate.min.js',
  'js/db.js',
  'js/stats.js',
  'js/export.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs: serve the cached copy instantly
// (works fully offline), and refresh the cache from the network in the
// background so the next launch gets any redeployed files.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    const fromNetwork = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(() => null);

    if (cached) return cached;              // background refresh keeps running
    const res = await fromNetwork;
    if (res) return res;
    // Offline and not cached: for page navigations, serve the app shell.
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
