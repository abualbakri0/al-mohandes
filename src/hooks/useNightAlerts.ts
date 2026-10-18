import { useState, useEffect, useCallback } from 'react';
import type { Lecture, Assignment, Exam, Department } from '@/lib/supabase';
import { fetchLectures, fetchAssignments, fetchExams } from '@/lib/api';

const DAY_MAP: Record<string, number> = {
  'الأحد': 0,
  'الإثنين': 1,
  'الثلاثاء': 2,
  'الأربعاء': 3,
  'الخميس': 4,
  'الجمعة': 5,
  'السبت': 6,
};

export type NightAlert = {
  type: 'lectures' | 'holiday';
  dayName: string;
  lectures: Lecture[];
  /** Assignments whose due_date falls on tomorrow. */
  assignments: Assignment[];
  /** Exams scheduled for tomorrow. */
  exams: Exam[];
};

/** 'YYYY-MM-DD' in LOCAL time (date columns compare as plain strings). */
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function useNightAlerts(department?: Department): NightAlert | null {
  const [alert, setAlert] = useState<NightAlert | null>(null);

  const check = useCallback(async () => {
    const now = new Date();
    const hour = now.getHours();

    // Evening banner: show from 21:00 (9 PM the previous evening) until
    // midnight (the greeting says "مساء الخير").
    if (hour < 21 || hour >= 24) {
      setAlert(null);
      return;
    }

    const todayIdx = now.getDay();
    const tomorrowIdx = (todayIdx + 1) % 7;
    const tomorrowDayName = Object.entries(DAY_MAP).find(([, idx]) => idx === tomorrowIdx)?.[0] ?? '';

    const todayKey = `night_alert_${now.toDateString()}_${department ?? 'all'}`;
    if (localStorage.getItem(todayKey)) {
      return;
    }

    try {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowIso = isoDate(tomorrow);

      const [lectures, assignments, exams] = await Promise.all([
        fetchLectures(department),
        fetchAssignments(department),
        fetchExams(department),
      ]);
      const tomorrowItems = lectures.filter((l) => l.day === tomorrowDayName);
      const holidayItems = tomorrowItems.filter((l) => l.is_holiday);
      const lectureItems = tomorrowItems
        .filter((l) => !l.is_holiday)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const dueItems = assignments
        .filter((a) => a.due_date === tomorrowIso)
        .sort((a, b) => a.subject.localeCompare(b.subject));
      const examItems = exams
        .filter((e) => e.exam_date === tomorrowIso)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      // "Free day" only when tomorrow has literally nothing (no lectures,
      // no submissions, no exams) — an assignments-only day still shows
      // the program banner.
      const hasProgram = lectureItems.length > 0 || dueItems.length > 0 || examItems.length > 0;
      const isHoliday = !hasProgram && holidayItems.length > 0;
      const freeDay = !hasProgram && !isHoliday;

      const alertData: NightAlert = isHoliday || freeDay
        ? { type: 'holiday', dayName: tomorrowDayName, lectures: [], assignments: [], exams: [] }
        : { type: 'lectures', dayName: tomorrowDayName, lectures: lectureItems, assignments: dueItems, exams: examItems };

      setAlert(alertData);
      localStorage.setItem(todayKey, JSON.stringify(alertData));
    } catch {
      setAlert(null);
    }
  }, [department]);

  useEffect(() => {
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [check]);

  return alert;
}

export function getDayName(date: Date): string {
  const idx = date.getDay();
  return Object.entries(DAY_MAP).find(([, dayIdx]) => dayIdx === idx)?.[0] ?? '';
}
