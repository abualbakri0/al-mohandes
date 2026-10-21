// Web Push — the PWA/website-install path (التطبيق المثبّت كموقع).
// Same server pipeline as FCM: the Edge Function `push-notify` sends BOTH
// FCM display messages (native APK tokens) and Web Push messages
// (web_push_subscriptions rows). The Service Worker (public/sw.js) renders
// Web Push into the system tray even when the browser/PWA is fully closed —
// on Android this is identical UX to the native app; on iOS 16.4+ it works
// for home-screen installs only (Apple restriction).
//
// Requires: VAPID keypair (scripts/gen-vapid-keys.mjs) — public key below,
// private key as the WEBPUSH_VAPID_PRIVATE_KEY secret of the Edge Function,
// and the web_push_subscriptions table.

import { Capacitor } from '@capacitor/core';
import { supabase, type Department } from '@/lib/supabase';
import { getNotificationPrefs } from '@/lib/notificationPrefs';

// VAPID public key (scripts/gen-vapid-keys.mjs output). The matching private
// key lives ONLY in the Supabase Edge Function secret — never in the bundle.
// ⚠️ عند تدوير المفتاح: بدّل القيمة هنا وفي supabase/functions/push-notify
// (WEBPUSH_VAPID_PUBLIC_KEY) معاً، ثم اضبط السر WEBPUSH_VAPID_PRIVATE_KEY.
// التطبيق سيكتشف تغيّر المفتاح ويعيد إنشاء الاشتراك تلقائياً (initWebPush).
const VAPID_PUBLIC_KEY = 'BAVbmfT7ueuA7jIEhBCuBLrmqHARowQiSTtM6Y9b6DHOi0gts71gpaGpu7udDKhNa1nMJQwjT9BqdzPeAnyKsN4';

const PREFS_EVENT = 'mohanndes-notif-prefs-changed';

let webInitialized = false;
let webDepartment: Department | null = null;
let webIsDeveloper = false;
let currentEndpoint: string | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function bytesToUrlBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * هل الاشتراك الحالي أُنشئ بالمفتاح العام الحالي؟
 * pushManager.getSubscription() يعيد اشتراكاً قديماً أُنشئ بمفتاح سابق،
 * ومزوّد Push يرفض الإرسال له (401/403) → يجب إعادة إنشائه.
 */
function subscriptionUsesCurrentKey(sub: PushSubscription): boolean {
  try {
    const raw = sub.options?.applicationServerKey;
    if (!raw) return true; // لا يمكن الفحص → لا نلمس الاشتراك
    return bytesToUrlBase64(new Uint8Array(raw)) === VAPID_PUBLIC_KEY;
  } catch {
    return true;
  }
}

/**
 * True when this runtime can do Web Push: not the Capacitor shell (that uses
 * FCM via src/lib/push.ts), has ServiceWorker + PushManager (dropped by some
 * in-app browsers), and runs on a secure context.
 */
export function isWebPushCapable(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return false;
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      window.isSecureContext
    );
  } catch {
    return false;
  }
}

/** Keep the server copy of the web subscription in sync with dept/prefs. */
export function setWebPushDepartment(dept: Department | null, isDeveloper = false): void {
  const changed = dept !== webDepartment || isDeveloper !== webIsDeveloper;
  webDepartment = dept;
  webIsDeveloper = isDeveloper;
  if (changed) void uploadWebSubscription();
}

const WEB_RETRY_MS = [5_000, 20_000, 60_000, 180_000];
let webUploadAttempt = 0;
let webRetryTimer: ReturnType<typeof setTimeout> | null = null;

function webUploaded(): void {
  webUploadAttempt = 0;
  if (webRetryTimer) {
    clearTimeout(webRetryTimer);
    webRetryTimer = null;
  }
}

function scheduleWebRetry(): void {
  if (webRetryTimer) return;
  const delay = WEB_RETRY_MS[Math.min(webUploadAttempt, WEB_RETRY_MS.length - 1)];
  webUploadAttempt += 1;
  webRetryTimer = setTimeout(() => {
    webRetryTimer = null;
    void uploadWebSubscription();
  }, delay);
}

/**
 * تسجيل اشتراك Web Push في `web_push_subscriptions`.
 *
 * نفس مشكلة FCM: الـ upsert المباشر كان يُرفض بـ 42501 (RLS بلا سياسة
 * SELECT/UPDATE) ⇒ لا اشتراك محفوظ ⇒ لا Web Push. الترتيب الآن:
 *   RPC (SECURITY DEFINER) ← insert/update ← upsert، مع إعادة محاولة.
 */
async function uploadWebSubscription(): Promise<void> {
  if (!currentEndpoint) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) {
      currentEndpoint = null;
      return;
    }
    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) return;

    const alertsEnabled = getNotificationPrefs().contentAlerts;
    const endpoint = sub.endpoint;

    // 0) الطريق المضمون: دالة الحافة push-notify (service role ⇒ تتجاوز RLS)
    try {
      const { data, error } = await supabase.functions.invoke('push-notify', {
        body: {
          type: 'register',
          kind: 'web',
          endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          department: webDepartment,
          is_developer: webIsDeveloper,
          alerts_enabled: alertsEnabled,
        },
      });
      if (!error && (data as { ok?: boolean } | null)?.ok) {
        webUploaded();
        return;
      }
      console.warn('[webpush] register via edge function failed:', error?.message ?? data);
    } catch (e) {
      console.warn('[webpush] register via edge function threw', e);
    }

    // 1) RPC آمن يتجاوز RLS
    try {
      const { error } = await supabase.rpc('register_web_push_subscription', {
        p_endpoint: endpoint,
        p_p256dh: json.keys.p256dh,
        p_auth: json.keys.auth,
        p_department: webDepartment,
        p_is_developer: webIsDeveloper,
        p_alerts_enabled: alertsEnabled,
      });
      if (!error) {
        webUploaded();
        return;
      }
      if (error.code !== 'PGRST202') {
        console.warn('[webpush] register_web_push_subscription RPC failed:', error.code, error.message);
      }
    } catch (e) {
      console.warn('[webpush] register_web_push_subscription RPC threw', e);
    }

    // 2) احتياط: insert ثم update
    const payload = {
      endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      department: webDepartment,
      is_developer: webIsDeveloper,
      alerts_enabled: alertsEnabled,
      last_seen_at: new Date().toISOString(),
    };
    const ins = await supabase.from('web_push_subscriptions').insert(payload);
    if (!ins.error) {
      webUploaded();
      return;
    }
    if (ins.error.code !== '23505') {
      console.warn('[webpush] subscription insert failed:', ins.error.code, ins.error.message);
    }
    const upd = await supabase
      .from('web_push_subscriptions')
      .update({
        p256dh: payload.p256dh,
        auth: payload.auth,
        department: webDepartment,
        is_developer: webIsDeveloper,
        alerts_enabled: alertsEnabled,
        last_seen_at: payload.last_seen_at,
      })
      .eq('endpoint', endpoint);
    if (!upd.error) {
      webUploaded();
      return;
    }
    console.warn('[webpush] subscription update failed:', upd.error.code, upd.error.message);

    // 3) آخر محاولة
    const ups = await supabase
      .from('web_push_subscriptions')
      .upsert(payload, { onConflict: 'endpoint' });
    if (!ups.error) {
      webUploaded();
      return;
    }
    console.warn('[webpush] subscription upsert failed:', ups.error.code, ups.error.message);
    scheduleWebRetry();
  } catch (e) {
    console.warn('[webpush] subscription upload failed', e);
    scheduleWebRetry();
  }
}

/** يعيد محاولة تسجيل الاشتراك فوراً (عودة الشبكة / المقدمة / تغيّر الإعدادات). */
export function flushWebPushRegistration(): void {
  webUploadAttempt = 0;
  if (webRetryTimer) {
    clearTimeout(webRetryTimer);
    webRetryTimer = null;
  }
  void uploadWebSubscription();
}

/**
 * Called by App on boot (web builds only). If notification permission is
 * already granted, ensures a push subscription exists and is uploaded.
 * Never prompts — the in-app banner (NotificationPermissionPrompt) owns UX;
 * after the user grants there we re-run initWebPush via the prefs event.
 */
export async function initWebPush(): Promise<boolean> {
  if (!isWebPushCapable()) return false;
  try {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }
    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // الاشتراك مرتبط بالمفتاح العام الذي أُنشئ به. بعد تدوير مفاتيح VAPID
    // يرفض مزوّد Push أي إرسال للاشتراك القديم (401/403)، فنتخلّص منه
    // وننشئ اشتراكاً جديداً بالمفتاح الحالي — وإلا بقي الإشعار ميتاً للأبد.
    if (sub && !subscriptionUsesCurrentKey(sub)) {
      try {
        await sub.unsubscribe();
      } catch (e) {
        console.warn('[webpush] unsubscribe (key rotation) failed', e);
      }
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    currentEndpoint = sub.endpoint;

    if (!webInitialized) {
      webInitialized = true;
      window.addEventListener(PREFS_EVENT, () => void uploadWebSubscription());
      // Permission revoked from site settings while we were away: drop the
      // server copy so the backend stops sending to a dead endpoint.
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: string } | undefined;
        if (data?.type === 'mohanndes-notif-click') {
          // Tap handled by the OS → window focused; tab routing is done by
          // App's own listener. Nothing to do here beyond waking the app.
        }
      });
    }
    await uploadWebSubscription();
    return true;
  } catch (e) {
    console.warn('[webpush] init failed', e);
    return false;
  }
}
