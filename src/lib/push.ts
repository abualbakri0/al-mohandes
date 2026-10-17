// FCM background push — the ONLY path that reaches a student when the app is
// fully closed (killed). Realtime (useOfficialRealtime) still handles the
// foreground instantly; FCM display messages are rendered by Android itself,
// so they land in the tray even with no app process alive.
//
// Dedup: FCM foreground events and Realtime events both call
// emitOfficialEvent() which persists markSeen(table,id) — first arrival wins.
//
// Requires: google-services.json in android/app/ (gradle applies the
// google-services plugin only when that file exists) + the Edge Function
// `push-notify` (supabase/functions/push-notify) + the push_tokens table.
// ============================================================

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase, type Department } from '@/lib/supabase';
import { getNotificationPrefs } from '@/lib/notificationPrefs';
import { CHANNEL_UPDATES, CHANNEL_ALERTS } from '@/lib/nativeNotifications';
import { emitOfficialEvent, markSeen, type ToastFn } from '@/lib/officialEmit';
import { consumeSelfWrite } from '@/lib/api';
import type { TabId } from '@/components/Navbar';

export type PushRegistration = {
  token: string;
  platform: 'android' | 'ios' | 'web';
};

const TOKEN_KEY = 'mohanndes_fcm_token';
const PREFS_EVENT = 'mohanndes-notif-prefs-changed';

// Latest UI handles — rebound by App on every render so callbacks stay fresh.
let prefsListenerAttached = false;
let displayBridge: { showToast: ToastFn; goToTab: (tab: TabId) => void } | null = null;
// Student department (null until known) — kept server-side in push_tokens.
let department: Department | null = null;
let isDeveloperDevice = false;
let initialized = false;

export function getStoredPushToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storePushToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearPushToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function isPushCapable(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Called by App (every render) so foreground/tap events can show toasts. */
export function bindPushDisplay(b: { showToast: ToastFn; goToTab: (tab: TabId) => void }): void {
  displayBridge = b;
}

/** Keep the server copy of the device token in sync with the student dept. */
export function setPushDepartment(dept: Department | null, isDeveloper = false): void {
  const changed = dept !== department || isDeveloper !== isDeveloperDevice;
  department = dept;
  isDeveloperDevice = isDeveloper;
  if (changed) void uploadPushToken();
}

/** Upsert token + prefs so the Edge Function can target/filter this device. */
async function uploadPushToken(): Promise<void> {
  const token = getStoredPushToken();
  if (!token) return;
  try {
    const { error } = await supabase.from('push_tokens').upsert(
      {
        token,
        department,
        is_developer: isDeveloperDevice,
        platform: 'android',
        alerts_enabled: getNotificationPrefs().contentAlerts,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    if (error) console.warn('[push] token upload failed', error.message);
  } catch (e) {
    console.warn('[push] token upload failed', e);
  }
}

/**
 * Foreground FCM delivery: Android does NOT show notification messages while
 * the app is visible — it hands them to us instead. Render through the shared
 * emit path (deduped against Realtime via markSeen).
 *
 * NOTE on the Capacitor data shape: for `notification` messages the custom
 * keys arrive under `n.data` (mirror of the FCM `data` object), NOT under
 * `n.notification.data`. We read both so no event is ever dropped silently.
 */
function handleForegroundPush(n: { data?: unknown; notification?: { title?: string; body?: string; data?: unknown } }): void {
  try {
    const data = ((n.data ?? n.notification?.data ?? {}) as Record<string, string>);
    const table = data.table;
    const id = data.id;
    if (!table || !id || !displayBridge) return;
    // Own edit echoed back as FCM (race: this copy can beat Realtime) —
    // suppress and mark seen so the Realtime copy is suppressed too.
    if (data.evt === 'update' && consumeSelfWrite(table, id)) {
      markSeen(table, id, 'update');
      return;
    }
    void emitOfficialEvent({
      table,
      id,
      title: n.notification?.title ?? '🔔 إشعار جديد',
      body: n.notification?.body ?? '',
      tab: (data.tab || 'notifications') as TabId,
      urgent: data.urgent === 'true',
      // UPDATE pushes dedupe against the Realtime UPDATE popup (per-evt key).
      evt: data.evt === 'update' ? 'update' : 'insert',
      showToast: displayBridge.showToast,
      goToTab: displayBridge.goToTab,
    });
  } catch (e) {
    console.warn('[push] foreground handle failed', e);
  }
}

/**
 * Tap on an FCM notification (any app state, including cold start from killed)
 * -> jump straight to the relevant tab. Mirrors local-notification tap handling.
 */
function handlePushTap(a: { data?: unknown; notification?: { data?: unknown } }): void {
  try {
    const data = ((a.data ?? a.notification?.data ?? {}) as Record<string, string>);
    const tab = data.tab as TabId | undefined;
    if (tab && displayBridge) displayBridge.goToTab(tab);
  } catch {
    // ignore
  }
}

/**
 * Called by App on boot. Ensures notification permission, FCM channels,
 * token registration/upload, and foreground/tap listeners. Idempotent.
 */
export async function initPush(): Promise<PushRegistration | null> {
  const stored = getStoredPushToken();
  if (!Capacitor.isNativePlatform()) {
    return stored ? { token: stored, platform: 'android' } : null;
  }

  if (initialized) {
    await uploadPushToken();
    return stored ? { token: stored, platform: 'android' } : null;
  }
  initialized = true;

  // FCM display messages need the channels to exist on-device; create the
  // same ids the local-notification layer uses (createChannel is idempotent).
  try {
    await PushNotifications.createChannel({
      id: CHANNEL_UPDATES,
      name: 'تحديثات التطبيق',
      description: 'اشعارات المحاضرات والتكاليف والاختبارات والمراجع الجديدة',
      importance: 4,
      lights: true,
      lightColor: '#0D9488',
    });
    await PushNotifications.createChannel({
      id: CHANNEL_ALERTS,
      name: 'تنبيهات عاجلة',
      description: 'تأجيل المحاضرات والتنبيهات العاجلة من المطور',
      importance: 5,
      lights: true,
      lightColor: '#EF4444',
    });
  } catch (e) {
    console.warn('[push] createChannel failed', e);
  }

  try {
    await PushNotifications.requestPermissions();
  } catch (e) {
    console.warn('[push] requestPermissions failed', e);
  }
  // Attach listeners before registering: Android may deliver the token
  // immediately, and registering first can lose that one-time event.

  try {
    await PushNotifications.addListener('registration', (t) => {
      storePushToken(t.value);
      void uploadPushToken();
    });
    await PushNotifications.addListener('pushNotificationReceived', (n) => handleForegroundPush(n));
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => handlePushTap(a));
    if (!prefsListenerAttached) {
      prefsListenerAttached = true;
      window.addEventListener(PREFS_EVENT, () => void uploadPushToken());
    }
  } catch (e) {
    console.warn('[push] listeners failed', e);
  }

  try {
    await PushNotifications.register();
  } catch (e) {
    // Typical cause: Firebase/Google Services is not configured correctly.
    console.warn('[push] register failed — check google-services.json and Firebase setup', e);
  }

  await uploadPushToken();
  const now = getStoredPushToken();
  return now ? { token: now, platform: 'android' } : null;
}


