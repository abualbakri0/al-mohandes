/* المهندس — Service Worker: offline shell + installable PWA.
 * Strategy: NETWORK-FIRST for the HTML shell (navigations), cache-first for
 * build-time static assets, and let Supabase (cross-origin) pass straight
 * through — the app already handles its own offline cache for data.
 *
 * لماذا network-first للـ HTML:
 *   الخطة القديمة (cache-first مع اسم كاش ثابت) كانت تُقدّم دائماً نسخة
 *   index.html المحفوظة، أي أن الجهاز يبقى يشغّل حزمة JS قديمة (الهاش القديم)
 *   ولو نُشر إصلاح جديد — وهذا بالضبط ما يُبقي بعض الهواتف على كود قديم
 *   لتتبّع الإنجاز. الآن: عند وجود شبكة نجلب الـ HTML الجديد دائماً ونخزّنه،
 *   وعند انقطاعها نُقدّم آخر نسخة محفوظة.
 */
const CACHE = 'mohanndes-pwa-v3';
const SHELL_URL = './index.html';
const CORE = ['./', SHELL_URL, './manifest.webmanifest'];

/* ── داخل تطبيق الأندرويد (Capacitor) لا خدمة عمال إطلاقاً ────────────────
 * التطبيق يُقدّم ملفاته من خادم محلي داخل الـ WebView على https://localhost.
 * طلبات الـ Service Worker (net) لا تمرّ على ذلك الخادم، فأي اعتراض لطلب
 * الصفحة يعني فشل تحميل التطبيق بالكامل: "Webpage not available / net::ERR_FAILED".
 * لذلك: على أصل localhost نلغي التسجيل ونحذف كل الكاشات (تعافٍ ذاتي)، ولا
 * نعترض أي طلب. الـ PWA/offline يبقى يعمل على النطاق الحقيقي (Vercel) فقط.
 * --------------------------------------------------------------------- */
const IS_NATIVE_APP = self.location.hostname === 'localhost';

async function selfDestruct() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* ignore */ }
  try {
    await self.registration.unregister();
  } catch { /* ignore */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!IS_NATIVE_APP) {
        try {
          const cache = await caches.open(CACHE);
          await cache.addAll(CORE);
        } catch { /* offline install — the runtime handler fills the cache later */ }
      }
      // Always take over: a permanent "waiting" worker used to leave devices
      // running an old shell forever.
      try { await self.skipWaiting(); } catch { /* ignore */ }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (IS_NATIVE_APP) {
        await selfDestruct();
        return;
      }
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      } catch { /* ignore */ }
      try { await self.clients.claim(); } catch { /* ignore */ }
    })()
  );
});

// The page asks the worker to remove itself (e.g. detection of a native shell).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'mohanndes-sw-unregister') {
    event.waitUntil(selfDestruct());
  }
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
  // داخل التطبيق: لا نعترض شيئاً — الـ WebView يخدم الملفات بنفسه.
  if (IS_NATIVE_APP) return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Never cache Supabase / cross-origin API — let the app handle it.
  if (url.origin !== self.location.origin) return;
  // The worker script itself must always reach the network.
  if (url.pathname.endsWith('/sw.js')) return;

  // ── 1) التنقل بين الصفحات (HTML shell): الشبكة أولاً ──────────────────
  // يضمن أن كل جهاز يشغّل آخر حزمة منشورة (وبالتالي كود العزل الجديد)،
  // ومع انقطاع الشبكة نُقدّم آخر نسخة محفوظة من الصفحة.
  // ملاحظة مهمة: لا نُرجع أبداً Response.error() لأن ذلك يبدّل الصفحة إلى
  // شاشة خطأ ولا يُبقي أي مخرج للمستخدم؛ عند تعذّر كل شيء نُعيد الخطأ
  // الأصلي ليظهر كخطأ شبكة عادي (أو صفحة offline في المتصفح).
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE);
            const copy = fresh.clone();
            cache.put(req, copy).catch(() => {});
            cache.put(SHELL_URL, fresh).catch(() => {});
          }
          return fresh;
        } catch (err) {
          try {
            const cache = await caches.open(CACHE);
            const exact = await cache.match(req, { ignoreSearch: true });
            if (exact) return exact;
            const shell = await cache.match(SHELL_URL);
            if (shell) return shell;
          } catch { /* ignore */ }
          throw err;
        }
      })()
    );
    return;
  }

  // ── 2) الأصول الثابتة (JS/CSS/صور بأسماء مُهشَّرة): الكاش أولاً ────────
  // اسم الملف يتغيّر مع كل بناء، فلا خطر من تقديم نسخة قديمة منه.
  event.respondWith(
    caches.match(req).then((cached) => {
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
      return fetch(req);
    })
  );
});
