// ============================================================
// FCM background push â€” the ONLY path that reaches a student when the app is
// fully closed (killed). Realtime (useOfficialRealtime) still handles the
// foreground instantly; FCM display messages are rendered by Android itself,
// so they land in the tray even with no app process alive.
//
// Dedup: FCM foreground events and Realtime events both call
// emitOfficialEvent() which persists markSeen(table,id) â€” first arrival wins.
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
import { emitOfficialEvent, type ToastFn } from '@/lib/officialEmit';
import type { TabId } from '@/components/Navbar';

export type PushRegistration = {
  token: string;
  platform: 'android' | 'ios' | 'web';
};

const TOKEN_KEY = 'mohanndes_fcm_token';
const PREFS_EVENT = 'mohanndes-notif-prefs-changed';

// Latest UI handles â€” rebound by App on every render so callbacks stay fresh.
let displayBridge: { showToast: ToastFn; goToTab: (tab: TabId) => void } | null = null;
// Student department (null until known) â€” kept server-side in push_tokens.
let department: Department | null = null;
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
export function setPushDepartment(dept: Department | null): void {
  department = dept;
  void uploadPushToken();
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
 * the app is visible â€” it hands them to us instead. Render through the shared
 * emit path (deduped against Realtime via markSeen).
 */
function handleForegroundPush(n: { notification?: { title?: string; body?: string; data?: unknown } }): void {
  try {
    const raw = n.notification?.data;
    const data = (raw ?? {}) as Record<string, string>;
    const table = data.table;
    const id = data.id;
    if (!table || !id || !displayBridge) return;
    void emitOfficialEvent({
      table,
      id,
      title: n.notification?.title ?? 'ًں”” ط¥ط´ط¹ط§ط± ط¬ط¯ظٹط¯',
      body: n.notification?.body ?? '',
      tab: (data.tab || 'notifications') as TabId,
      urgent: data.urgent === 'true',
      showToast: displayBridge.showToast,
      goToTab: displayBridge.goToTab,
    });
  } catch (e) {
    console.warn('[push] foreground handle failed', e);
  }
}

/**
 * Tap on an FCM notification (any app state, including cold start from killed)
 * â†’ jump straight to the relevant tab. Mirrors local-notification tap handling.
 */
function handlePushTap(a: { notification?: { data?: unknown } }): void {
  try {
    const data = (a.notification?.data ?? {}) as Record<string, string>;
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
      name: 'طھط­ط¯ظٹط«ط§طھ ط§ظ„طھط·ط¨ظٹظ‚',
      description: 'ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…ط­ط§ط¶ط±ط§طھ ظˆط§ظ„طھظƒط§ظ„ظٹظپ ظˆط§ظ„ط§ط®طھط¨ط§ط±ط§طھ ظˆط§ظ„ظ…ط±ط§ط¬ط¹ ط§ظ„ط¬ط¯ظٹط¯ط©',
      importance: 4,
      lights: true,
      lightColor: '#0D9488',
    });
    await PushNotifications.createChannel({
      id: CHANNEL_ALERTS,
      name: 'طھظ†ط¨ظٹظ‡ط§طھ ط¹ط§ط¬ظ„ط©',
      description: 'طھط£ط¬ظٹظ„ ط§ظ„ظ…ط­ط§ط¶ط±ط§طھ ظˆط§ظ„طھظ†ط¨ظٹظ‡ط§طھ ط§ظ„ط¹ط§ط¬ظ„ط© ظ…ظ† ط§ظ„ظ…ط·ظˆط±',
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

  try {
    await PushNotifications.register();
  } catch (e) {
    // Typical cause: google-services.json not placed in android/app/ yet.
    console.warn('[push] register failed â€” is google-services.json present?', e);
  }

  try {
    await PushNotifications.addListener('registration', (t) => {
      storePushToken(t.value);
      void uploadPushToken();
    });
    await PushNotifications.addListener('pushNotificationReceived', (n) => handleForegroundPush(n));
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => handlePushTap(a));
    window.addEventListener(PREFS_EVENT, () => void uploadPushToken());
  } catch (e) {
    console.warn('[push] listeners failed', e);
  }

  await uploadPushToken();
  const now = getStoredPushToken();
  return now ? { token: now, platform: 'android' } : null;
}


