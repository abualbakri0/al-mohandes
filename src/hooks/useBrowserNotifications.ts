import { useEffect, useCallback } from 'react';
import type { Notification, Lecture, Assignment, Exam } from '@/lib/supabase';
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
  enabled: boolean,
  nightAssignments: Assignment[] = [],
  nightExams: Exam[] = [],
) {
  const checkAndNotify = useCallback(() => {
    if (!enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    const todayKey = `notif_${now.toDateString()}`;

    // Evening program notification — same 21:00 window as the in-app banner.
    const hour = now.getHours();
    if (hour >= 21 && hour < 24) {
      const nightKey = `night_notif_${todayKey}`;
      if (!localStorage.getItem(nightKey)) {
        if (isHoliday && nightDayName) {
          showInstantNotification('إجازة غداً', `غداً يوم ${nightDayName} — لا توجد محاضرات. استمتع بإجازتك!`);
          localStorage.setItem(nightKey, '1');
        } else if (nightDayName && nightLectures && (nightLectures.length > 0 || nightAssignments.length > 0 || nightExams.length > 0)) {
          const parts: string[] = [];
          if (nightLectures.length > 0) {
            const lectureList = nightLectures.map((l) => `${l.subject} (${formatTime12(l.start_time)})`).join('، ');
            parts.push(`${nightLectures.length} محاضرة: ${lectureList}`);
          }
          if (nightAssignments.length > 0) {
            parts.push(`تسليم ${nightAssignments.length} تكليف: ${nightAssignments.map((a) => a.subject).join('، ')}`);
          }
          if (nightExams.length > 0) {
            parts.push(`${nightExams.length} اختبار: ${nightExams.map((e) => e.subject).join('، ')}`);
          }
          showInstantNotification(
            `برنامج غداً — ${nightDayName}`,
            parts.join(' — ')
          );
          localStorage.setItem(nightKey, '1');
        }
      }
    }
  }, [nightLectures, nightDayName, isHoliday, enabled, nightAssignments, nightExams]);

  useEffect(() => {
    checkAndNotify();
    const interval = setInterval(checkAndNotify, 60000);
    return () => clearInterval(interval);
  }, [checkAndNotify]);
}
