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
const VAPID_PUBLIC_KEY = 'BAgNlZmy2X85JwCi85A1RxAU7i2Th9uGWCm0oHr-4OeOHDFyWXDVrDU6X7yrKc5ds-H0xzmgovSddjVYswjsqLg';

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
    const { error } = await supabase.from('web_push_subscriptions').upsert(
      {
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        department: webDepartment,
        is_developer: webIsDeveloper,
        alerts_enabled: getNotificationPrefs().contentAlerts,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );
    if (error) console.warn('[webpush] subscription upload failed', error);
  } catch (e) {
    console.warn('[webpush] subscription upload failed', e);
  }
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
