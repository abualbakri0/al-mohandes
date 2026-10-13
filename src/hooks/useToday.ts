import { useState, useEffect } from 'react';
import { isolateTime } from '@/lib/time';

const ARABIC_DAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export type TodayInfo = {
  dayName: string;
  dateLabel: string;
  timeLabel: string;
};

export function useToday(): TodayInfo {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const dayName = ARABIC_DAYS[now.getDay()];
  const day = now.getDate();
  const month = ARABIC_MONTHS[now.getMonth()];
  const year = now.getFullYear();
  const dateLabel = `${day} ${month} ${year}`;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const period = hours < 12 ? 'صباحاً' : 'مساءً';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  // نعزل الوقت اتجاهياً (LRI…PDI) حتى يبقى الرقم ملتصقاً بكلمته (صباحاً/مساءً)
  // ولا ينقلب داخل الصفحة العربية، بدلاً من الاعتماد على dir="ltr" في الواجهة.
  const timeLabel = isolateTime(`${displayHours}:${String(minutes).padStart(2, '0')} ${period}`);

  return { dayName, dateLabel, timeLabel };
}
