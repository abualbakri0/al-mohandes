// Scheduled lecture reminders + evening summary via NATIVE notifications.
// - 60min & 15min before each upcoming lecture (today + tomorrow)
// - Daily 19:00 evening summary of tomorrow's lectures
// Reschedules whenever department changes or every 30min.
// Works when app is open OR minimized (system alarm).

import { useEffect, useRef } from 'react';
import { fetchLectures, fetchStudyTasks, fetchAssignments } from '@/lib/api';
import { getNotificationPrefs } from '@/lib/notificationPrefs';
import {
  scheduleNativeReminder,
  cancelNativeReminders,
  notifyNow,
  CHANNEL_REMINDERS,
} from '@/lib/nativeNotifications';
import { formatTime12 } from '@/lib/time';
import type { Department, Lecture } from '@/lib/supabase';

const DAY_INDEX: Record<string, number> = {
  'الأحد': 0, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3,
  'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
};

function nextDateForDay(dayName: string, timeHHmm: string): Date | null {
  const targetIdx = DAY_INDEX[dayName];
  if (targetIdx === undefined) return null;
  const [h, m] = timeHHmm.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const now = new Date();
  const d = new Date(now);
  const delta = (targetIdx - now.getDay() + 7) % 7;
  d.setDate(now.getDate() + delta);
  d.setHours(h, m ?? 0, 0, 0);
  // If today but time already passed and delta==0, push to next week? No — skip past times.
  if (d.getTime() <= now.getTime() + 60_000) {
    if (delta === 0) return null;
  }
  return d;
}

export function useLectureReminders(department: Department | null, userName?: string | null) {
  const deptRef = useRef(department);
  deptRef.current = department;
  const nameRef = useRef(userName);
  nameRef.current = userName;
  const scheduledIds = useRef<number[]>([]);

  /** Reminder title: just "تذكير" (per request). */
  const reminderTitle = (): string => 'تذكير';

  /** Body starts with the user's first name: "فلان، لديك ..." (per request). */
  const reminderBody = (text: string): string => {
    const first = (nameRef.current ?? '').trim().split(/\s+/)[0];
    return first ? `${first}، ${text}` : text;
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const reschedule = async () => {
      const prefs = getNotificationPrefs();
      // Clear old schedules first
      if (scheduledIds.current.length > 0) {
        await cancelNativeReminders(scheduledIds.current);
        scheduledIds.current = [];
      }
      if (!prefs.lectureReminders && !prefs.eveningSummary && !prefs.studyMotivation && !prefs.assignmentReminders) return;

      let lectures: Lecture[] = [];
      let studyTasks: { id: string; subject: string; task_type: 'review' | 'prestudy'; day: string; start_time: string }[] = [];
      let assignments: { id: string; subject: string; title: string; due_date: string }[] = [];
      try {
        [lectures, studyTasks, assignments] = await Promise.all([
          fetchLectures(deptRef.current ?? undefined),
          fetchStudyTasks(deptRef.current ?? undefined).catch(() => [] as typeof studyTasks),
          prefs.assignmentReminders
            ? fetchAssignments(deptRef.current ?? undefined).catch(() => [] as typeof assignments)
            : Promise.resolve([] as typeof assignments),
        ]);
      } catch {
        return;
      }
      if (cancelled) return;
      const items = lectures.filter((l) => !l.is_holiday);
      const now = new Date();

      // 1) Lecture reminders (60 + 15 min before)
      if (prefs.lectureReminders) {
        for (const lec of items) {
          const start = nextDateForDay(lec.day, lec.start_time);
          if (!start) continue;
          // Only schedule within next 8 days
          if (start.getTime() - now.getTime() > 8 * 24 * 3600 * 1000) continue;
          const teacher = lec.teacher ? ` — م.${lec.teacher}` : '';
          const place = lec.location ? ` — ${lec.location}` : '';
          const base = `${lec.subject}${teacher}${place}`;
          // 60 min before (the single per-lecture reminder, per request:
          // "مرة في الصباح ... قبل المحاضرة بساعة")
          const t60 = new Date(start.getTime() - 60 * 60 * 1000);
          if (t60.getTime() > now.getTime() + 60_000) {
            const id = await scheduleNativeReminder({
              title: reminderTitle(),
              body: reminderBody(`لديك محاضرة ${base} — الساعة ${formatTime12(lec.start_time)} (يوم ${lec.day})`),
              at: t60,
              data: { tab: 'schedule' },
            });
            scheduledIds.current.push(id);
          }
        }
      }

      // 2) Evening summary — next 19:00 (local)
      if (prefs.eveningSummary) {
        const evening = new Date(now);
        evening.setHours(19, 0, 0, 0);
        if (evening.getTime() <= now.getTime()) {
          evening.setDate(evening.getDate() + 1);
        }
        const tomorrowIdx = (evening.getDay() + 1) % 7;
        // Find day name for day-after-evening? No: summary at 19:00 covers TOMORROW.
        // evening is today 19:00 → tomorrow = evening.date + 1
        const summaryDate = new Date(evening);
        summaryDate.setDate(evening.getDate() + 1);
        void tomorrowIdx;
        const dayNameOf = (d: Date): string | null => {
          const entry = Object.entries(DAY_INDEX).find(([, idx]) => idx === d.getDay());
          return entry ? entry[0] : null;
        };
        const tomorrowName = dayNameOf(summaryDate);
        if (tomorrowName) {
          const tomorrowLecs = items
            .filter((l) => l.day === tomorrowName)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          const id = await scheduleNativeReminder({
            title: reminderTitle(),
            body: reminderBody(
              tomorrowLecs.length > 0
                ? `محاضرات الغد (${tomorrowName}): ${tomorrowLecs.map((l) => `${l.subject} ${formatTime12(l.start_time)}`).join('، ')}`
                : `غداً (${tomorrowName}) إجازة — لا توجد محاضرات 🎉`,
            ),
            at: evening,
            channel: CHANNEL_REMINDERS,
            data: { tab: 'schedule' },
          });
          scheduledIds.current.push(id);
        }
      }

      // 3) Daily study tasks — next 16:00 (local). Shows the study tasks the
      // developer scheduled for THAT day (today if before 16:00, else tomorrow).
      if (prefs.studyMotivation) {
        const at16 = new Date(now);
        at16.setHours(16, 0, 0, 0);
        if (at16.getTime() <= now.getTime()) {
          at16.setDate(at16.getDate() + 1);
        }
        // Arabic day name for the notification's day.
        const dayNameOf = (d: Date): string | null => {
          const entry = Object.entries(DAY_INDEX).find(([, idx]) => idx === d.getDay());
          return entry ? entry[0] : null;
        };
        const targetDay = dayNameOf(at16);
        const dayTasks = targetDay
          ? studyTasks
              .filter((t) => t.day === targetDay)
              .sort((a, b) => a.start_time.localeCompare(b.start_time))
          : [];
        // Only notify when there are actual tasks for that day (no empty nudges).
        if (dayTasks.length > 0) {
          const list = dayTasks
            .map((t) => `${t.subject} (${t.task_type === 'review' ? 'مراجعة' : 'مذاكرة'})`)
            .join('، ');
          const id = await scheduleNativeReminder({
            title: 'مهام مذاكرة اليوم 📚',
            body: reminderBody(`مهام ${targetDay}: ${list}`),
            at: at16,
            channel: CHANNEL_REMINDERS,
            data: { tab: 'study' },
          });
          scheduledIds.current.push(id);
        }
      }

      // 4) Assignment due reminders — one day before each due date at 20:00.
      // Fires even if the student already checked the assignment (they may
      // still need to submit it), so completion is intentionally ignored here.
      if (prefs.assignmentReminders) {
        for (const a of assignments) {
          const due = new Date(`${a.due_date}T00:00:00`);
          if (Number.isNaN(due.getTime())) continue;
          const at = new Date(due);
          at.setDate(due.getDate() - 1);
          at.setHours(20, 0, 0, 0);
          // Skip if the reminder time is already past; reschedule runs every 30min.
          if (at.getTime() <= now.getTime() + 60_000) continue;
          // Only within the next 8 days (keeps the queue small).
          if (at.getTime() - now.getTime() > 8 * 24 * 3600 * 1000) continue;
          const id = await scheduleNativeReminder({
            title: 'تذكير بتسليم تكليف ⏰',
            body: reminderBody(`غدًا تسليم تكليف ${a.subject}: ${a.title}`),
            at,
            channel: CHANNEL_REMINDERS,
            data: { tab: 'assignments' },
          });
          scheduledIds.current.push(id);
        }
      }
    };

    reschedule();
    timer = setInterval(reschedule, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);
}

/** Fire-and-forget test notification (used in settings "جرّب الإشعار"). */
export async function sendTestNotification(): Promise<void> {
  await notifyNow({
    title: '🔔 إشعار تجريبي',
    body: 'الإشعارات الرسمية شغالة — ستصلك التنبيهات في شريط النظام',
    channel: CHANNEL_REMINDERS,
    data: { tab: 'notifications' },
  });
}
