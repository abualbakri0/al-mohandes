import { useState, useEffect, useCallback } from 'react';
import type { Lecture, Department } from '@/lib/supabase';
import { fetchLectures } from '@/lib/api';

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
};

export function useNightAlerts(department?: Department): NightAlert | null {
  const [alert, setAlert] = useState<NightAlert | null>(null);

  const check = useCallback(async () => {
    const now = new Date();
    const hour = now.getHours();

    // Evening banner: show from 22:00 until midnight (the greeting says "مساء الخير").
    if (hour < 22 || hour >= 24) {
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
      const lectures = await fetchLectures(department);
      const tomorrowItems = lectures.filter((l) => l.day === tomorrowDayName);
      const holidayItems = tomorrowItems.filter((l) => l.is_holiday);
      const lectureItems = tomorrowItems
        .filter((l) => !l.is_holiday)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      const isHoliday = holidayItems.length > 0 && lectureItems.length === 0;

      const alertData: NightAlert = isHoliday
        ? { type: 'holiday', dayName: tomorrowDayName, lectures: [] }
        : lectureItems.length > 0
        ? { type: 'lectures', dayName: tomorrowDayName, lectures: lectureItems }
        : { type: 'holiday', dayName: tomorrowDayName, lectures: [] };

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
