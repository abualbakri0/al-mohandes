/* المهندس — Service Worker: offline shell + installable PWA.
 * Strategy: cache-first for app shell (same-origin GET), network-first
 * for API calls (Supabase) with cache fallback already handled in-app.
 */
const CACHE = 'mohanndes-pwa-v1';
const CORE = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache Supabase / cross-origin API — let the app handle it.
  if (url.origin !== self.location.origin) return;
  // Only handle navigations + static assets we produced at build time.
  // Let Vite's hashed asset URLs pass through on miss (no offline fake).
  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then((cached) => {
      if (cached) {
        // Refresh in background, serve instantly.
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
        }).catch(() => {});
        return cached;
      }
      // Navigation fallback: serve cached shell for SPA routes.
      if (req.mode === 'navigate') {
        return caches.match('./index.html').then((shell) => shell || fetch(req));
      }
      return fetch(req);
    })
  );
});
