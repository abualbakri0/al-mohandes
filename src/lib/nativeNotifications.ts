// Native (official) notifications service — WhatsApp-style.
// On Android (Capacitor): system notification bar with sound,
// vibration, app icon. Works when app is open OR minimized.
// On web: falls back to the Web Notification API.
// Channels: updates (high), reminders (default), alerts (max).
//
// NOTE about the app name: Android itself always renders the app name
// ("المهندس") + small icon in the notification header automatically.
// To make the branding unmistakable inside the popup, we also set
// summaryText: 'المهندس' (shown as the summary line on Android) and
// keep the small app icon configured in capacitor.config.ts.

import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  type ScheduleOptions,
} from '@capacitor/local-notifications';
import { playNotificationSound, vibrate } from '@/hooks/useNotificationSound';
import { getBadgeCount } from '@/lib/appBadge';

export const APP_DISPLAY_NAME = 'المهندس';
export const CHANNEL_UPDATES = 'mohanndes_updates';
export const CHANNEL_REMINDERS = 'mohanndes_reminders';
export const CHANNEL_ALERTS = 'mohanndes_alerts';

export type NotifyChannel = typeof CHANNEL_UPDATES | typeof CHANNEL_REMINDERS | typeof CHANNEL_ALERTS;

export type NativeNotifyPayload = {
  title: string;
  body: string;
  channel: NotifyChannel;
  data?: Record<string, string>;
  id?: number;
  at?: Date;
};

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

let channelsReady = false;

async function ensureChannels(): Promise<void> {
  if (!isNative() || channelsReady) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_UPDATES,
      name: 'تحديثات التطبيق',
      description: 'إشعارات المحاضرات والتكاليف والاختبارات والمراجع الجديدة',
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#0D9488',
    });
    await LocalNotifications.createChannel({
      id: CHANNEL_REMINDERS,
      name: 'التذكيرات',
      description: 'تذكيرات المحاضرات والمهام والتذكير المسائي',
      importance: 3,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#F59E0B',
    });
    await LocalNotifications.createChannel({
      id: CHANNEL_ALERTS,
      name: 'تنبيهات عاجلة',
      description: 'تأجيل المحاضرات والتنبيهات العاجلة من المطور',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#EF4444',
    });
    channelsReady = true;
  } catch {
    // ignore — scheduling will still attempt a plain notification
  }
}

export async function requestNativePermission(): Promise<boolean> {
  if (isNative()) {
    try {
      await ensureChannels();
      const res = await LocalNotifications.requestPermissions();
      return res.display === 'granted';
    } catch {
      return false;
    }
  }
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') return true;
      const p = await Notification.requestPermission();
      return p === 'granted';
    } catch {
      return false;
    }
  }
  return false;
}

export async function isNativePermissionGranted(): Promise<boolean> {
  if (isNative()) {
    try {
      const res = await LocalNotifications.checkPermissions();
      return res.display === 'granted';
    } catch {
      return false;
    }
  }
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return Notification.permission === 'granted';
  }
  return false;
}

function randomId(): number {
  return Math.floor(Math.random() * 2000000000) + 1;
}

function showWebFallback(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notif = new Notification(title, {
      body,
      icon: '/vite.svg',
      dir: 'rtl',
      lang: 'ar',
      requireInteraction: false,
    });
    notif.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      notif.close();
    };
    setTimeout(() => {
      try { notif.close(); } catch { /* ignore */ }
    }, 9000);
  } catch {
    // ignore
  }
}

/** Show an official system notification NOW (WhatsApp-style). */
export async function notifyNow(payload: NativeNotifyPayload): Promise<void> {
  try { playNotificationSound(); } catch { /* ignore */ }
  try { vibrate([200, 100, 200]); } catch { /* ignore */ }
  if (isNative()) {
    try {
      await ensureChannels();
      // Attach the current unread count as the launcher badge number.
      const badge = Math.max(1, getBadgeCount() || 1);
      const options: ScheduleOptions = {
        notifications: [
          {
            id: payload.id ?? randomId(),
            title: payload.title,
            body: payload.body,
            summaryText: APP_DISPLAY_NAME,
            channelId: payload.channel,
            ongoing: false,
            autoCancel: true,
            badge,
            extra: payload.data ?? {},
          },
        ],
      };
      if (payload.at) {
        options.notifications[0].schedule = { at: payload.at, allowWhileIdle: true };
      }
      await LocalNotifications.schedule(options);
      return;
    } catch { /* fall through */ }
  }
  showWebFallback(payload.title, payload.body);
}

/** Schedule a future reminder. Returns id for cancel/replace. */
export async function scheduleNativeReminder(
  payload: { title: string; body: string; at: Date; data?: Record<string, string>; id?: number; channel?: NotifyChannel },
): Promise<number> {
  const id = payload.id ?? randomId();
  if (isNative()) {
    try {
      await ensureChannels();
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: payload.title,
            body: payload.body,
            summaryText: APP_DISPLAY_NAME,
            channelId: payload.channel ?? CHANNEL_REMINDERS,
            schedule: { at: payload.at, allowWhileIdle: true },
            ongoing: false,
            autoCancel: true,
            badge: Math.max(1, getBadgeCount() || 1),
            extra: payload.data ?? {},
          },
        ],
      });
    } catch { /* ignore */ }
  }
  return id;
}

export async function cancelNativeReminders(ids: number[]): Promise<void> {
  if (!isNative() || ids.length === 0) return;
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch { /* ignore */ }
}

/** Listen for taps on system notifications (deep-link). */
export function onNativeNotificationTap(cb: (data: Record<string, string>) => void): () => void {
  if (!isNative()) return () => {};
  let handle: { remove: () => void } | null = null;
  LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    cb((event.notification.extra ?? {}) as Record<string, string>);
  }).then((h) => { handle = h; }).catch(() => {});
  return () => { try { handle?.remove(); } catch { /* ignore */ } };
}

