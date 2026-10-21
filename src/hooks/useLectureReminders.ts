// Scheduled lecture reminders + evening summary via NATIVE notifications.
// - 60min & 15min before each upcoming lecture (today + tomorrow)
// - Daily 19:00 evening summary of tomorrow's lectures
// Reschedules whenever department changes or every 30min.
// Works when app is open OR minimized (system alarm).

import { useEffect, useRef } from 'react';
import { fetchLectures, fetchStudyTasks, fetchAssignments, fetchExams } from '@/lib/api';
import { getNotificationPrefs } from '@/lib/notificationPrefs';
import {
  scheduleNativeReminder,
  cancelNativeReminders,
  notifyNow,
  CHANNEL_REMINDERS,
} from '@/lib/nativeNotifications';
import { formatTime12, formatTimeRange } from '@/lib/time';
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

// Deterministic schedule ids: re-scheduling the SAME reminder reuses the same
// id, so even if two generations briefly overlap, the second schedule REPLACES
// the first instead of stacking a duplicate on top of it.
function stableId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2000000000 + 1;
}

export function useLectureReminders(department: Department | null, userName?: string | null) {
  const deptRef = useRef(department);
  deptRef.current = department;
  const nameRef = useRef(userName);
  nameRef.current = userName;
  const scheduledIds = useRef<number[]>([]);
  // Monotonic generation: stale reschedule runs (StrictMode double-mount,
  // overlapping interval ticks, dept changes) must not push ids into the
  // NEW generation, or cancel() would miss them and duplicates would fire.
  const generation = useRef(0);

  /** Reminder title: just "تذكير" (per request). */
  const reminderTitle = (): string => 'تذكير';

  /** Address the signed-in user by their first and second registered names. */
  const reminderBody = (text: string): string => {
    const firstTwoNames = (nameRef.current ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
    return firstTwoNames ? `${firstTwoNames}، ${text}` : text;
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // Serialize reschedule runs: an in-flight fetch/schedule must not overlap
    // the next tick, otherwise both runs schedule the same reminders and the
    // user gets 2+ system notifications for one reminder.
    let rescheduling = false;
    // Bump generation so any stale in-flight run aborts instead of pushing
    // ids that the new run's cancel() can no longer reach.
    generation.current += 1;
    const myGen = generation.current;

    const reschedule = async () => {
      if (rescheduling) return;
      rescheduling = true;
      try {
      const prefs = getNotificationPrefs();
      // Clear old schedules first
      if (scheduledIds.current.length > 0) {
        await cancelNativeReminders(scheduledIds.current);
        // Abandoned by a newer generation? Don't wipe its fresh ids.
        if (myGen !== generation.current || cancelled) return;
        scheduledIds.current = [];
      }
      if (!prefs.lectureReminders && !prefs.eveningSummary && !prefs.studyMotivation && !prefs.assignmentReminders) return;

      let lectures: Lecture[] = [];
      let studyTasks: { id: string; subject: string; task_type: 'review' | 'prestudy'; day: string; start_time: string }[] = [];
      let assignments: { id: string; subject: string; title: string; due_date: string }[] = [];
      let exams: { id: string; subject: string; exam_date: string; start_time: string; end_time: string; location: string | null; teacher: string | null }[] = [];
      try {
        [lectures, studyTasks, assignments, exams] = await Promise.all([
          fetchLectures(deptRef.current ?? undefined),
          fetchStudyTasks(deptRef.current ?? undefined).catch(() => [] as typeof studyTasks),
          prefs.assignmentReminders
            ? fetchAssignments(deptRef.current ?? undefined).catch(() => [] as typeof assignments)
            : Promise.resolve([] as typeof assignments),
          prefs.assignmentReminders
            ? fetchExams(deptRef.current ?? undefined).catch(() => [] as typeof exams)
            : Promise.resolve([] as typeof exams),
        ]);
      } catch {
        return;
      }
      if (cancelled || myGen !== generation.current) return;
      const items = lectures.filter((l) => !l.is_holiday);
      const now = new Date();

      // 1) Lecture reminders (60 + 15 min before)
      if (prefs.lectureReminders) {
        // ── الاستثناء 1 (تخطي منبه المحاضرة المؤجلة) ──
        // أي حصة مطابقة لقائمة التخطي المحلية (مادة + يوم + وقت) تُتخطى:
        // تلك الحصة المستهدفة فقط — دون المساس بباقي محاضرات اليوم
        // أو الجدول الأسبوعي للأيام القادمة. الفحص محلي خالص.
        let isPostponed: (s: string, d: string, t: string) => boolean = () => false;
        try {
          const mod = await import('@/lib/postponementSkip').catch(() => null);
          if (mod) isPostponed = mod.isLecturePostponed;
        } catch { /* ignore — عند العطل تُجدول كل المنبهات كالسابق */ }
        for (const lec of items) {
          if (isPostponed(lec.subject, lec.day, lec.start_time)) continue; // حصة مؤجلة → تخطي
          const start = nextDateForDay(lec.day, lec.start_time);
          if (!start) continue;
          // Only schedule within next 8 days
          if (start.getTime() - now.getTime() > 8 * 24 * 3600 * 1000) continue;
          const teacher = lec.teacher ? ` — م.${lec.teacher}` : '';
          const place = lec.location ? ` — ${lec.location}` : '';
          const base = `${lec.subject}${teacher}${place}`;
          const timeRange = lec.end_time ? formatTimeRange(lec.start_time, lec.end_time) : formatTime12(lec.start_time);
          // 60 min before only (the single per-lecture reminder, per request:
          // "مرة في الصباح ... قبل المحاضرة بساعة")
          const t60 = new Date(start.getTime() - 60 * 60 * 1000);
          if (t60.getTime() > now.getTime() + 60_000) {
            const id = await scheduleNativeReminder({
              id: stableId(`lec|${lec.day}|${lec.start_time}|${lec.subject}`),
              title: reminderTitle(),
              body: reminderBody(`لديك محاضرة ${base} — من ${timeRange} (يوم ${lec.day})`),
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
            id: stableId(`evening|${evening.toDateString()}`),
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

      // 3) Daily study tasks — schedule the next seven daily 16:00 reminders.
      // Study tasks are a recurring weekly schedule; only completion progress
      // resets at the Saturday week boundary, never the tasks themselves.
      if (prefs.studyMotivation) {
        const dayNameOf = (d: Date): string | null => {
          const entry = Object.entries(DAY_INDEX).find(([, idx]) => idx === d.getDay());
          return entry ? entry[0] : null;
        };
        for (let offset = 0; offset < 7; offset += 1) {
          const at16 = new Date(now);
          at16.setDate(now.getDate() + offset);
          at16.setHours(16, 0, 0, 0);
          if (at16.getTime() <= now.getTime() + 60_000) continue;

          const targetDay = dayNameOf(at16);
          if (!targetDay) continue;
          const dayTasks = studyTasks
            .filter((t) => t.day === targetDay)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          // Only notify on days that actually have study tasks.
          if (dayTasks.length === 0) continue;

          const list = dayTasks
            .map((t) => `${t.subject} (${t.task_type === 'review' ? 'مراجعة' : 'مذاكرة'})`)
            .join('، ');
          const id = await scheduleNativeReminder({
            id: stableId(`study|${at16.toDateString()}|${targetDay}`),
            title: `مهام ${targetDay} 📚`,
            body: reminderBody(`مهام اليوم: ${list}`),
            at: at16,
            channel: CHANNEL_REMINDERS,
            data: { tab: 'study', day: targetDay },
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
            id: stableId(`assign|${a.id}|${a.due_date}`),
            title: 'تذكير بتسليم تكليف ⏰',
            body: reminderBody(`غدًا تسليم تكليف ${a.subject}: ${a.title}`),
            at,
            channel: CHANNEL_REMINDERS,
            data: { tab: 'assignments' },
          });
          scheduledIds.current.push(id);
        }
      }

      // 5) Exam reminders — one day before each exam date at 20:00.
      if (prefs.assignmentReminders) {
        for (const e of exams) {
          const examDay = new Date(`${e.exam_date}T00:00:00`);
          if (Number.isNaN(examDay.getTime())) continue;
          const at = new Date(examDay);
          at.setDate(examDay.getDate() - 1);
          at.setHours(20, 0, 0, 0);
          // Skip if the reminder time is already past; reschedule runs every 30min.
          if (at.getTime() <= now.getTime() + 60_000) continue;
          // Only within the next 8 days (keeps the queue small).
          if (at.getTime() - now.getTime() > 8 * 24 * 3600 * 1000) continue;
          const examTime = e.end_time ? formatTimeRange(e.start_time, e.end_time) : formatTime12(e.start_time);
          const examPlace = e.location ? ` — القاعة ${e.location}` : '';
          const examTeacher = e.teacher ? ` — م.${e.teacher}` : '';
          const id = await scheduleNativeReminder({
            id: stableId(`exam|${e.id}|${e.exam_date}`),
            title: 'تذكير باختبار ⏰',
            body: reminderBody(`غدًا اختبار ${e.subject} — من ${examTime}${examPlace}${examTeacher} (يوم ${e.exam_date})`),
            at,
            channel: CHANNEL_REMINDERS,
            data: { tab: 'exams' },
          });
          scheduledIds.current.push(id);
        }
      }
      } finally {
        rescheduling = false;
      }
    };

    reschedule();
    timer = setInterval(reschedule, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // Re-run when the department (or user) changes so reminders retarget
    // immediately instead of waiting up to 30min for the next interval tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, userName]);
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
