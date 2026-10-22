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

/**
 * الحالة الثانية (تنظيف التوكن عند الخروج اليدوي فقط):
 * حذف صف FCM Token الخاص بهذا الجهاز من جدول `push_tokens` في السيرفر
 * ثم تصفير النسخة المحلية — ليتوقف الجهاز عن استقبال الإشعارات بعد الخروج.
 * - Fire-and-forget: لا ترمي استثناءً أبداً ولا تمنع إتمام الخروج.
 * - المسح المحلي يتم أولاً وبشكل متزامن لمنع أي re-upload متسابق
 *   (setPushDepartment/uploadPushToken) من إعادة إنشاء الصف بعد الحذف.
 * - لا تمس أي جزء آخر من نظام الإشعارات.
 */
export function unregisterPushToken(): void {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  // Clear locally FIRST (sync) to win any re-upload race.
  clearPushToken();
  if (!token) return;
  const doomed = token;
  void (async () => {
    try {
      const { error } = await supabase.from('push_tokens').delete().eq('token', doomed);
      if (error) console.warn('[push] token delete failed', error.message);
    } catch (e) {
      console.warn('[push] token delete failed', e);
    }
  })();
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

/**
 * Upsert token + prefs so the Edge Function can target/filter this device.
 *
 * لماذا أُعيدت كتابة هذا الجزء:
 * كان `.upsert()` المباشر يفشل دائماً على هذا المشروع:
 *   POST /rest/v1/push_tokens?on_conflict=token  →  42501
 *   "new row violates row-level security policy for table push_tokens"
 * (سياسة SELECT/UPDATE مفقودة على الجدول)، أي أن **أي جهاز جديد لم يكن
 * يُسجَّل إطلاقاً** ⇒ لا إشعارات في الخلفية. الحل ثلاثي المستويات:
 *   1) RPC بصلاحية SECURITY DEFINER يتجاوز RLS (migration 20261022090000).
 *   2) إن لم يكن موجوداً: INSERT عادي، ثم UPDATE عند التكرار (23505).
 *   3) وأخيراً upsert (يعمل لو أُصلحت سياسات RLS).
 * مع إعادة محاولة تلقائية متزايدة حتى لو كان الجهاز بلا شبكة لحظة التسجيل.
 */
const UPLOAD_RETRY_MS = [5_000, 20_000, 60_000, 180_000];
let uploadAttempt = 0;
let uploadRetryTimer: ReturnType<typeof setTimeout> | null = null;

function tokenUploaded(token: string): void {
  uploadAttempt = 0;
  if (uploadRetryTimer) {
    clearTimeout(uploadRetryTimer);
    uploadRetryTimer = null;
  }
  console.log('[push] token registered OK:', String(token).slice(0, 12) + '…', 'dept=', department);
}

function scheduleUploadRetry(): void {
  if (uploadRetryTimer) return;
  const delay = UPLOAD_RETRY_MS[Math.min(uploadAttempt, UPLOAD_RETRY_MS.length - 1)];
  uploadAttempt += 1;
  uploadRetryTimer = setTimeout(() => {
    uploadRetryTimer = null;
    void uploadPushToken();
  }, delay);
}

async function uploadPushToken(): Promise<void> {
  const token = getStoredPushToken();
  if (!token) return;

  const alertsEnabled = getNotificationPrefs().contentAlerts;
  const payload = {
    token,
    department,
    is_developer: isDeveloperDevice,
    platform: 'android',
    alerts_enabled: alertsEnabled,
    last_seen_at: new Date().toISOString(),
  };

  // 0) الطريق المضمون: دالة الحافة push-notify تكتب بمفتاح service role
  // (يتجاوز RLS)، فتنجح حتى لو كانت سياسات push_tokens تمنع anon تماماً.
  try {
    const { data, error } = await supabase.functions.invoke('push-notify', {
      body: {
        type: 'register',
        kind: 'fcm',
        token,
        platform: 'android',
        department,
        is_developer: isDeveloperDevice,
        alerts_enabled: alertsEnabled,
      },
    });
    if (!error && (data as { ok?: boolean } | null)?.ok) {
      tokenUploaded(token);
      return;
    }
    console.warn('[push] register via edge function failed:', error?.message ?? data);
  } catch (e) {
    console.warn('[push] register via edge function threw', e);
  }

  // 1) الطريق الآمن: RPC يتجاوز RLS
  try {
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_department: department,
      p_is_developer: isDeveloperDevice,
      p_platform: 'android',
      p_alerts_enabled: alertsEnabled,
    });
    if (!error) {
      tokenUploaded(token);
      return;
    }
    // PGRST202 = الدالة غير منشورة بعد (الملف لم يُشغَّل) → نكمل للاحتياط
    if (error.code !== 'PGRST202') {
      console.warn('[push] register_push_token RPC failed:', error.code, error.message);
    }
  } catch (e) {
    console.warn('[push] register_push_token RPC threw', e);
  }

  // 2) احتياط: INSERT، وإن كان الصف موجوداً UPDATE
  try {
    const ins = await supabase.from('push_tokens').insert(payload);
    if (!ins.error) {
      tokenUploaded(token);
      return;
    }
    if (ins.error.code !== '23505') {
      console.warn('[push] token insert failed:', ins.error.code, ins.error.message);
    }

    const upd = await supabase
      .from('push_tokens')
      .update({ department, is_developer: isDeveloperDevice, alerts_enabled: alertsEnabled, last_seen_at: payload.last_seen_at })
      .eq('token', token);
    if (!upd.error) {
      tokenUploaded(token);
      return;
    }
    console.warn('[push] token update failed:', upd.error.code, upd.error.message);
  } catch (e) {
    console.warn('[push] token upload threw', e);
  }

  // 3) آخر محاولة: upsert (يعمل فقط لو كانت سياسات RLS سليمة)
  try {
    const { error } = await supabase.from('push_tokens').upsert(payload, { onConflict: 'token' });
    if (!error) {
      tokenUploaded(token);
      return;
    }
    console.warn('[push] token upsert failed:', error.code, error.message);
  } catch (e) {
    console.warn('[push] token upsert threw', e);
  }

  // لم ينجح أي طريق (غالباً بلا شبكة أو RLS) → أعد المحاولة لاحقاً
  scheduleUploadRetry();
}

/**
 * يعيد محاولة تسجيل الجهاز فوراً — يستدعيها App عند:
 * عودة الشبكة، عودة التطبيق للمقدمة، وتغيّر الإعدادات.
 */
export function flushPushRegistration(): void {
  uploadAttempt = 0;
  if (uploadRetryTimer) {
    clearTimeout(uploadRetryTimer);
    uploadRetryTimer = null;
  }
  void uploadPushToken();
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
    // Own edit/add echoed back as FCM (race: this copy can beat Realtime) —
    // suppress and mark seen so the Realtime copy is suppressed too.
    const evt = data.evt === 'update' ? 'update' : 'insert';
    if (consumeSelfWrite(table, id)) {
      markSeen(table, id, evt);
      return;
    }
    // ── الاستثناء 1 (مسار FCM الأمامي): إشعار تأجيل يصل والتطبيق مفتوح —
    // سجّل الحصة المستهدفة في قائمة التخطي (نفس منطق Realtime).
    if (data.urgent === 'true' && table === 'notifications') {
      try {
        const title = n.notification?.title ?? '';
        const body = n.notification?.body ?? '';
        void import('@/lib/postponementSkip').then((m) => {
          const parsed = m.parsePostponement(title, body);
          if (parsed) m.markLecturePostponed(parsed.subject, parsed.day, parsed.startTime);
        }).catch(() => {});
      } catch { /* ignore */ }
    }
    void emitOfficialEvent({
      table,
      id,
      title: n.notification?.title ?? '🔔 إشعار جديد',
      body: n.notification?.body ?? '',
      tab: (data.tab || 'notifications') as TabId,
      urgent: data.urgent === 'true',
      // UPDATE pushes dedupe against the Realtime UPDATE popup (per-evt key).
      evt,
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
    try {
      const perm = await PushNotifications.checkPermissions();
      console.log('[push] notification permission =', perm.receive);
    } catch { /* ignore */ }
  } catch (e) {
    console.warn('[push] requestPermissions failed', e);
  }
  // Attach listeners before registering: Android may deliver the token
  // immediately, and registering first can lose that one-time event.

  try {
    await PushNotifications.addListener('registration', (t) => {
      storePushToken(t.value);
      console.log('[push] FCM token received:', String(t.value).slice(0, 12) + '...');
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


