import { useEffect, useCallback } from 'react';
import type { Notification, Lecture } from '@/lib/supabase';
import { playNotificationSound, vibrate } from '@/hooks/useNotificationSound';
import { formatTime12 } from '@/lib/time';

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string, tag?: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notif = new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: tag ?? title + body,
      dir: 'rtl',
      lang: 'ar',
      requireInteraction: false,
      badge: '/icons/icon-192.png',
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
    };

    setTimeout(() => {
      try { notif.close(); } catch { /* ignore */ }
    }, 8000);
  } catch {
    // ignore
  }
}

export function showInstantNotification(title: string, body: string, tag?: string): void {
  playNotificationSound();
  vibrate([200, 100, 200]);
  showBrowserNotification(title, body, tag);
}

export function useBrowserNotifications(
  notifications: Notification[],
  nightLectures: Lecture[] | null,
  nightDayName: string | null,
  isHoliday: boolean,
  enabled: boolean
) {
  const checkAndNotify = useCallback(() => {
    if (!enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    const todayKey = `notif_${now.toDateString()}`;

    // Night lecture/holiday notification (after 6pm)
    const hour = now.getHours();
    if (hour >= 18 && hour < 23) {
      const nightKey = `night_notif_${todayKey}`;
      if (!localStorage.getItem(nightKey)) {
        if (isHoliday && nightDayName) {
          showInstantNotification('إجازة غداً', `غداً يوم ${nightDayName} — لا توجد محاضرات. استمتع بإجازتك!`);
          localStorage.setItem(nightKey, '1');
        } else if (nightLectures && nightLectures.length > 0 && nightDayName) {
          const lectureList = nightLectures.map((l) => `${l.subject} (${formatTime12(l.start_time)})`).join('، ');
          showInstantNotification(
            `محاضرات غداً — ${nightDayName}`,
            `لديك ${nightLectures.length} محاضرة غداً: ${lectureList}`
          );
          localStorage.setItem(nightKey, '1');
        }
      }
    }
  }, [nightLectures, nightDayName, isHoliday, enabled]);

  useEffect(() => {
    checkAndNotify();
    const interval = setInterval(checkAndNotify, 60000);
    return () => clearInterval(interval);
  }, [checkAndNotify]);
}
