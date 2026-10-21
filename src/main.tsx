import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';
import './index.css';

// ── شبكة أمان عامة (قبل أي رسم) ──────────────────────────────────────────
// أي خطأ يخرج من React (داخل setTimeout/Promise/مستمع حدث) كان يظهر كتجمد
// صامت بلا أي رسالة. هنا نسجّله فقط ولا نوقف التطبيق، مع كاشف بسيط
// لإعادة التحميل إذا بقيت الشاشة فارغة (root بلا أبناء) بعد الإقلاع.
function installGlobalGuards(): void {
  window.addEventListener('error', (event) => {
    const err = (event as ErrorEvent).error as unknown;
    console.error('[ui] uncaught error:', err ?? (event as ErrorEvent).message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[ui] unhandled promise rejection:', (event as PromiseRejectionEvent).reason);
  });

  const BLANK_FLAG = 'mohanndes_blank_reload';
  const startedAt = Date.now();
  window.setInterval(() => {
    try {
      if (document.readyState !== 'complete') return;
      if (Date.now() - startedAt < 8_000) return; // مهلة إقلاع معقولة
      const root = document.getElementById('root');
      if (root && root.childElementCount > 0) return;
      if (sessionStorage.getItem(BLANK_FLAG) === '1') return; // مرة واحدة فقط
      sessionStorage.setItem(BLANK_FLAG, '1');
      console.warn('[ui] blank screen detected — reloading once');
      window.location.reload();
    } catch {
      // ignore
    }
  }, 2_000);
}

installGlobalGuards();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
);

// علامة الإقلاع الناجح: يقرأها حرّاس أندرويد (MainActivity) بعد بضع ثوانٍ.
// إن لم تُضبط فمعناه أن حزمة الويب لم تُنفَّذ أصلاً (صفحة خطأ/ملف مفقود)،
// فيُعيد الحارس تهيئة بيانات الويب ويُعيد التحميل مرة واحدة.
(window as unknown as { __APP_READY__?: boolean }).__APP_READY__ = true;

// Register the offline/PWA service worker (moved out of index.html so the
// Content-Security-Policy can forbid inline scripts).
//
// ⚠ داخل تطبيق الأندرويد (Capacitor) لا نُسجّل أي Service Worker:
//   الـ WebView يخدم الملفات من خادم محلي (https://localhost) لا تستطيع
//   طلبات الـ SW الوصول إليه، فأي اعتراض لطلب الصفحة يجعل التطبيق كله
//   يعرض "Webpage not available … net::ERR_FAILED" ولا يفتح.
//   ولذلك أيضاً نُلغي أي تسجيل قديم (من إصدار سابق) ونحذف كاشاته ليتعافى
//   الجهاز فوراً. الكاش المحلي لبيانات التطبيق (localStorage/IndexedDB)
//   لا يُمسّ، فيبقى تسجيل الدخول ومفتاح التقدّم كما هو.
const isNativeApp = (() => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
})();

if ('serviceWorker' in navigator) {
  if (isNativeApp) {
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
        for (const reg of regs) {
          try {
            reg.active?.postMessage({ type: 'mohanndes-sw-unregister' });
          } catch {
            /* ignore */
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
        }
      } catch {
        /* ignore — nothing to clean up */
      }
    })();
  } else {
    // A newly deployed build takes control → reload once so this tab stops
    // running the old hashed bundle. Without it, a device that kept a cached
    // index.html could stay on pre-isolation code for days.
    // The flag stops any reload loop; the controller check skips the very first
    // install (nothing to replace).
    const SW_RELOAD_FLAG = 'mohanndes_sw_reloaded';
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      try {
        if (sessionStorage.getItem(SW_RELOAD_FLAG) === '1') return;
        sessionStorage.setItem(SW_RELOAD_FLAG, '1');
      } catch {
        return; // no storage → never risk a reload loop
      }
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}
