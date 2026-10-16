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

/* ---------------------------------------------------------------
 * Web Push (إشعارات الموقع المثبّت كتطبيق/PWA)
 * يستقبل رسائل الخادم (Edge Function push-notify) حتى لو كان
 * التطبيق/المتصفح مغلقًا تمامًا — يعرضها النظام نفسه في الشريط.
 * إذا كان النافذة ظاهرة (foreground) نتجاهل لأن الإشعار الداخلي
 * (Realtime) يعرض toast بالفعل — نفس سلوك تطبيق الأندرويد.
 * ------------------------------------------------------------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'المهندس';
  event.waitUntil((async () => {
    try {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windowClients.some((c) => c.visibilityState === 'visible')) return;
    } catch { /* ignore — show the notification anyway */ }
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      // One notification per source row — redeliveries collapse.
      tag: data.table && data.id ? `${data.table}-${data.id}` : title,
      data: { tab: data.tab || 'notifications', urgent: data.urgent === 'true' },
      vibrate: data.urgent === 'true' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tab = (event.notification.data || {}).tab;
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      try { client.postMessage({ type: 'mohanndes-notif-click', tab }); } catch { /* ignore */ }
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow('./');
  })());
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
