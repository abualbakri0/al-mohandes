import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, BookOpen, ClipboardList, FileText, MapPin, Coffee, Check, Loader2, CalendarDays } from 'lucide-react';
import { DAYS, displayDepartment, type Lecture, type Assignment, type Exam, type Department } from '@/lib/supabase';
import { formatTimeRange } from '@/lib/time';
import { fetchLectures, fetchAssignments, fetchExams, fetchAssignmentProgress } from '@/lib/api';
import { fetchWithCache } from '@/lib/offlineStore';

type Props = {
  userId?: string;
  department?: Department;
};

// JS Date#getDay() names — used to match a stored weekday (DAYS values) with
// an actual calendar date.
const JS_DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/**
 * Next occurrence of a weekday (today included) — the daily program is a
 * planner, so each chip maps to the COMING date of that day rather than a
 * stale past one. Iteration guarantees a match within 7 days.
 */
function nextOccurrence(dayName: string): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (JS_DAYS_AR[d.getDay()] === dayName) return d;
  }
  return today;
}

/** 'YYYY-MM-DD' in LOCAL time (due_date/exam_date are date columns). */
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dateLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS_AR[d.getMonth()]}`;
}

export default function DailyProgramView({ userId, department }: Props) {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const [selectedDay, setSelectedDay] = useState<string>(() => JS_DAYS_AR[new Date().getDay()]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first like every other view: fall back to the last snapshot.
      const [lec, asg, exm] = await Promise.all([
        fetchWithCache<Lecture>('lectures', department, () => fetchLectures(department)),
        fetchWithCache<Assignment>('assignments', department, () => fetchAssignments(department)),
        fetchWithCache<Exam>('exams', department, () => fetchExams(department)),
      ]);
      setLectures(lec.rows);
      setAssignments(asg.rows);
      setExams(exm.rows);
      if (userId) {
        fetchAssignmentProgress(userId)
          .then(setProgress)
          .catch(() => {
            /* server map unavailable — read-only view stays un-checked */
          });
      }
    } finally {
      setLoading(false);
    }
  }, [department, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedDate = nextOccurrence(selectedDay);
  const selectedIso = isoDate(selectedDate);
  const isToday = selectedIso === isoDate(new Date());

  // Day-scoped data (everything is read-only — no writes anywhere here).
  const dayLectures = lectures
    .filter((l) => l.day === selectedDay)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const dayAssignments = assignments
    .filter((a) => a.due_date === selectedIso)
    .sort((a, b) => a.subject.localeCompare(b.subject));
  const dayExams = exams
    .filter((e) => e.exam_date === selectedIso)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const nothingAtAll = dayLectures.length === 0 && dayAssignments.length === 0 && dayExams.length === 0;

  // إذا كان اليوم إجازة (محاضرة بها is_holiday=true) نعرض "إجازة" فقط دون أي بيانات أخرى.
  const isHoliday = dayLectures.some((l) => l.is_holiday);

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-md">
          <CalendarClock className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">البرنامج اليومي</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {selectedDay} — {dateLabel(selectedDate)}
            {isToday && <span className="text-teal-600 dark:text-teal-400 font-medium"> (اليوم)</span>}
          </p>
        </div>
      </div>

      {/* Weekday chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {DAYS.map((day) => {
          const dayDate = nextOccurrence(day);
          const active = day === selectedDay;
          const isCurrentDay = isoDate(dayDate) === isoDate(new Date());
          return (
            <button
              key={day}
              onClick={() => setSelectedDay(day)}
              className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200 border ${
                active
                  ? 'bg-teal-600 text-white border-teal-600 shadow-md scale-[1.03]'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-700'
              }`}
            >
              <span className="flex items-center gap-1">
                {day}
                {isCurrentDay && (
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-red-500'}`} />
                )}
              </span>
              <span className={`text-[10px] ${active ? 'text-teal-100' : 'text-slate-400 dark:text-slate-500'}`}>
                {dayDate.getDate()}/{dayDate.getMonth() + 1}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
        </div>
      ) : isHoliday ? (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <Coffee className="w-16 h-16 mx-auto text-amber-500 dark:text-amber-400 mb-4" />
          <h3 className="text-2xl font-bold text-amber-700 dark:text-amber-300 mb-2">إجازة</h3>
          <p className="text-slate-500 dark:text-slate-400">
            اليوم إجازة — لا توجد محاضرات، تكاليف أو اختبارات مبرمجة.
          </p>
        </div>
      ) : nothingAtAll ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <CalendarDays className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">لا يوجد شيء مبرمج في هذا اليوم.</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">محاضرات، تكاليف واختبارات هذا اليوم ستظهر هنا.</p>
        </div>
      ) : (
        <>
          {/* Lectures */}
          <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 bg-teal-50 dark:bg-teal-950/30 border-b border-teal-100 dark:border-teal-900/50">
              <BookOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <h3 className="font-bold text-teal-800 dark:text-teal-200 text-sm">المحاضرات</h3>
              <span className="mr-auto text-xs font-bold bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full">
                {dayLectures.length}
              </span>
            </div>
            {dayLectures.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">لا توجد محاضرات في هذا اليوم.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {dayLectures.map((l) => (
                  <li key={l.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="text-xs font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 px-2 py-1 rounded-lg whitespace-nowrap">
                      {formatTimeRange(l.start_time, l.end_time)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm truncate">{l.subject}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                        {l.is_holiday ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                            <Coffee className="w-3 h-3" /> إجازة
                          </span>
                        ) : (
                          <>
                            {l.location && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> {l.location}
                              </span>
                            )}
                            {l.teacher && <span>م. {l.teacher}</span>}
                          </>
                        )}
                      </p>
                    </div>
                    {l.department && (
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {displayDepartment(l.department)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Assignments due */}
          <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-100 dark:border-amber-900/50">
              <ClipboardList className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <h3 className="font-bold text-amber-800 dark:text-amber-200 text-sm">تسليم التكاليف</h3>
              <span className="mr-auto text-xs font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                {dayAssignments.length}
              </span>
            </div>
            {dayAssignments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">لا توجد تكاليف تُسلّم في هذا اليوم.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {dayAssignments.map((a) => {
                  const done = !!progress[a.id];
                  return (
                    <li key={a.id} className="px-5 py-3.5 flex items-center gap-3">
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                          done
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {done && <Check className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold text-sm truncate ${done ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>
                          {a.subject}: {a.title}
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          موعد التسليم {dateLabel(new Date(`${a.due_date}T00:00:00`))}
                        </p>
                      </div>
                      {a.department && (
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                          {displayDepartment(a.department)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Exams */}
          <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-100 dark:border-rose-900/50">
              <FileText className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <h3 className="font-bold text-rose-800 dark:text-rose-200 text-sm">الاختبارات</h3>
              <span className="mr-auto text-xs font-bold bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-full">
                {dayExams.length}
              </span>
            </div>
            {dayExams.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">لا توجد اختبارات في هذا اليوم.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {dayExams.map((e) => (
                  <li key={e.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-1 rounded-lg whitespace-nowrap">
                      {formatTimeRange(e.start_time, e.end_time)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm truncate">{e.subject}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                        {e.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {e.location}
                          </span>
                        )}
                        {e.teacher && <span>م. {e.teacher}</span>}
                      </p>
                    </div>
                    {e.department && (
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {displayDepartment(e.department)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
