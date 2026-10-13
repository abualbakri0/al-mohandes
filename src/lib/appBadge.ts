// ============================================================
// App-icon badge: shows the unread-notifications count on the
// launcher icon (Android badge / dot).
//
// Implementation notes (Capacitor local-notifications 8.3.1):
// - There is NO standalone setBadgeCount API in this version.
// - Instead, every scheduled notification carries `badge: N`
//   (NotificationCompat.setNumber on Android).
// - So we persist the unread count in localStorage (per account)
//   and attach it to each notifyNow()/scheduleNativeReminder() call.
// - When the user opens the notifications tab, App calls
//   clearAppBadge() which resets the stored counter and posts a
//   silent "clear" notification with badge 0... actually the OS
//   clears the number when notifications are dismissed; the stored
//   counter is what matters for the NEXT notification.
// - Web: mirrors the count into document.title ("(3) المهندس").
// ============================================================

import { Capacitor } from '@capacitor/core';

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

const BASE_TITLE = 'المهندس';

function accountSuffix(): string {
  try {
    const raw = localStorage.getItem('univ_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { phone?: string };
      if (parsed?.phone) return `_${String(parsed.phone).replace(/[^0-9+]/g, '') || 'shared'}`;
    }
  } catch {
    /* ignore */
  }
  return '_shared';
}

function counterKey(): string {
  return `mohanndes_badge${accountSuffix()}`;
}

/** Current stored unread count for this account. */
export function getBadgeCount(): number {
  try {
    const raw = localStorage.getItem(counterKey());
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function persist(n: number): void {
  try {
    localStorage.setItem(counterKey(), String(Math.max(0, n)));
  } catch {
    /* ignore */
  }
  if (!isNative()) {
    try {
      document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
    } catch {
      /* ignore */
    }
  }
}

/** Set the badge counter to `count` (0 clears it). Never throws. */
export async function setAppBadge(count: number): Promise<void> {
  persist(Math.max(0, Math.floor(count) || 0));
}

/** Increment the badge counter by 1 and return the new value. */
export async function bumpAppBadge(): Promise<number> {
  const next = getBadgeCount() + 1;
  persist(next);
  return next;
}

/** Clear the badge counter (called when the user opens notifications). */
export async function clearAppBadge(): Promise<void> {
  persist(0);
}

