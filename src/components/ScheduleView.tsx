import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Clock, MapPin, Loader2, CalendarDays, Cpu, Zap, Users, Coffee, User, CloudUpload } from 'lucide-react';
import { DAYS, DEPARTMENT_OPTIONS, displayDepartment, type Lecture, type Department } from '@/lib/supabase';
import { formatTimeRange } from '@/lib/time';
import { fetchLectures, addLecture, updateLecture, deleteLecture } from '@/lib/api';
import { fetchWithCache, isPendingId, updateQueuedOp, dequeue } from '@/lib/offlineStore';
import { runOrQueue } from '@/lib/offlineSync';
import { useToast } from '@/components/ToastProvider';

type Props = {
  isDeveloper: boolean;
  department?: Department;
};

const DEPT_STYLES: Record<string, { active: string; badge: string; bar: string; icon: typeof Cpu }> = {
  'ميكاترونكس': { active: 'bg-cyan-100 text-cyan-700 ring-2 ring-cyan-400', badge: 'bg-cyan-100 text-cyan-700', bar: 'bg-cyan-500', icon: Cpu },
  'كهربائية': { active: 'bg-amber-100 text-amber-700 ring-2 ring-amber-400', badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', icon: Zap },
  'مشترك': { active: 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400', badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', icon: Users },
};

// A distinct visual identity per weekday so the timetable is easy to scan:
// each day gets its own header tint, icon gradient, title color, count pill
// and card border. Keys match the values in `DAYS` from '@/lib/supabase'.
type DayStyle = {
  header: string;
  text: string;
  badge: string;
  cardBorder: string;
  iconGrad: string;
};

const DAY_STYLES: Record<string, DayStyle> = {
  'السبت': {
    header: 'bg-teal-50 dark:bg-teal-950/30',
    text: 'text-teal-700 dark:text-teal-300',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
    cardBorder: 'border-teal-200 dark:border-teal-900/60',
    iconGrad: 'from-teal-500 to-cyan-600',
  },
  'الأحد': {
    header: 'bg-sky-50 dark:bg-sky-950/30',
    text: 'text-sky-700 dark:text-sky-300',
    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    cardBorder: 'border-sky-200 dark:border-sky-900/60',
    iconGrad: 'from-sky-500 to-blue-600',
  },
  'الإثنين': {
    header: 'bg-indigo-50 dark:bg-indigo-950/30',
    text: 'text-indigo-700 dark:text-indigo-300',
    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300',
    cardBorder: 'border-indigo-200 dark:border-indigo-900/60',
    iconGrad: 'from-indigo-500 to-violet-600',
  },
  'الثلاثاء': {
    header: 'bg-amber-50 dark:bg-amber-950/30',
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    cardBorder: 'border-amber-200 dark:border-amber-900/60',
    iconGrad: 'from-amber-500 to-orange-600',
  },
  'الأربعاء': {
    header: 'bg-rose-50 dark:bg-rose-950/30',
    text: 'text-rose-700 dark:text-rose-300',
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
    cardBorder: 'border-rose-200 dark:border-rose-900/60',
    iconGrad: 'from-rose-500 to-pink-600',
  },
  'الخميس': {
    header: 'bg-fuchsia-50 dark:bg-fuchsia-950/30',
    text: 'text-fuchsia-700 dark:text-fuchsia-300',
    badge: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/50 dark:text-fuchsia-300',
    cardBorder: 'border-fuchsia-200 dark:border-fuchsia-900/60',
    iconGrad: 'from-fuchsia-500 to-purple-600',
  },
  'الجمعة': {
    header: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    cardBorder: 'border-emerald-200 dark:border-emerald-900/60',
    iconGrad: 'from-emerald-500 to-green-600',
  },
};

export default function ScheduleView({ isDeveloper, department }: Props) {
  const { showToast } = useToast();
  const [lectures, setLectures] = useState<(Lecture & { __pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [day, setDay] = useState<string>(DAYS[0]);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [teacher, setTeacher] = useState('');
  const [selectedDept, setSelectedDept] = useState<Department>('ميكاترونكس');
  const [isHoliday, setIsHoliday] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first: falls back to the last snapshot instead of wiping the view.
      const res = await fetchWithCache<Lecture>('lectures', department, () => fetchLectures(department));
      setLectures(res.rows);
    } finally {
      setLoading(false);
    }
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setSubject('');
    setLocation('');
    setTeacher('');
    setIsHoliday(false);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (lecture: Lecture) => {
    setEditingId(lecture.id);
    setIsHoliday(lecture.is_holiday);
    setSubject(lecture.is_holiday ? 'إجازة' : lecture.subject);
    setDay(lecture.day);
    setStartTime(lecture.start_time);
    setEndTime(lecture.end_time);
    setLocation(lecture.location ?? '');
    setTeacher(lecture.teacher ?? '');
    setSelectedDept(lecture.department ?? 'ميكاترونكس');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHoliday && !subject.trim()) return;
    setSubmitting(true);
    const subjectValue = isHoliday ? 'إجازة' : subject.trim();
    const fields = {
      subject: subjectValue,
      day,
      start_time: startTime,
      end_time: endTime,
      location: location.trim(),
      department: selectedDept,
      is_holiday: isHoliday,
      teacher: teacher.trim(),
    };
    try {
      if (editingId) {
        if (isPendingId(editingId)) {
          // Row was created offline and is still queued — patch the queued op in place.
          const qid = editingId.slice('pending_'.length);
          updateQueuedOp(qid, {
            payload: { ...fields, row: { ...(lectures.find((l) => l.id === editingId) ?? {}), ...fields } },
            label: `تعديل محاضرة (محلي): ${subjectValue}`,
          });
          showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        } else {
          const res = await runOrQueue(
            { table: 'lectures', action: 'update', payload: { id: editingId, fields }, label: `تعديل محاضرة: ${subjectValue}` },
            () => updateLecture(editingId, fields)
          );
          if (res.status === 'queued') {
            showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
          }
        }
      } else {
        const res = await runOrQueue(
          {
            table: 'lectures',
            action: 'insert',
            payload: {
              ...fields,
              row: { id: '', created_at: new Date().toISOString(), ...fields },
            },
            label: `إضافة محاضرة: ${subjectValue}`,
          },
          () => addLecture(fields.subject, fields.day, fields.start_time, fields.end_time, fields.location, fields.department, fields.is_holiday, fields.teacher)
        );
        if (res.status === 'queued') {
          showToast('تم الحفظ محليًا', 'ستُنشر المحاضرة تلقائيًا عند عودة الاتصال', 'info');
        }
      }
      resetForm();
      await load();
    } catch {
      showToast('تعذر الحفظ', 'حدث خطأ غير متوقع. حاول مرة أخرى.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isPendingId(id)) {
      // Never published — just drop it from the local queue.
      dequeue(id.slice('pending_'.length));
      setLectures((prev) => prev.filter((l) => l.id !== id));
      return;
    }
    try {
      const res = await runOrQueue(
        { table: 'lectures', action: 'delete', payload: { id }, label: 'حذف محاضرة' },
        () => deleteLecture(id)
      );
      if (res.status === 'queued') {
        showToast('تم الحذف محليًا', 'سيُنفّذ الحذف عند عودة الاتصال', 'info');
      }
      setLectures((prev) => prev.filter((l) => l.id !== id));
    } catch {
      // ignore
    }
  };

  const lecturesByDay = DAYS.map((d) => ({
    day: d,
    items: lectures
      .filter((l) => l.day === d)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  })).filter((g) => g.items.length > 0);

  // A holiday row is NOT a lecture, so it must never be counted as one.
  // This drives the per-day badge ("3 محاضرة" vs "إجازة").
  const lectureCountOf = (items: Lecture[]): number => items.filter((l) => !l.is_holiday).length;

  return (
    <div className="space-y-6 animate-fade-in-up transition-colors duration-300">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center shadow-md">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">جدول المحاضرات</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{lectureCountOf(lectures)} محاضرة مجدولة</p>
          </div>
        </div>
        {isDeveloper && (
          <button
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setEditingId(null);
                setShowForm(true);
              }
            }}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <Plus className="w-5 h-5" />
            إضافة محاضرة
          </button>
        )}
      </div>

      {showForm && isDeveloper && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 animate-scale-in transition-colors duration-300"
        >
          {/* Holiday toggle */}
          <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl p-3 border border-emerald-100 dark:border-emerald-900">
            <button
              type="button"
              onClick={() => setIsHoliday(!isHoliday)}
              className={`relative w-12 h-6 rounded-full transition-all ${isHoliday ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white dark:bg-slate-800 shadow transition-all ${isHoliday ? 'left-0.5' : 'right-0.5'}`} />
            </button>
            <div className="flex items-center gap-2">
              <Coffee className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">إجازة (لا توجد محاضرات في هذا اليوم)</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!isHoliday && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">المادة</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="اسم المادة"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">اليوم</label>
              <select
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all bg-white dark:bg-slate-800"
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            {!isHoliday && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">من الساعة</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">إلى الساعة</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">المكان (اختياري)</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="قاعة / رقم القاعة"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">المدرس (اختياري)</label>
                  <input
                    type="text"
                    value={teacher}
                    onChange={(e) => setTeacher(e.target.value)}
                    placeholder="اسم المدرس"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                  />
                </div>
              </>
            )}
            <div className={isHoliday ? 'sm:col-span-2' : ''}>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">القسم</label>
              <div className="flex gap-2 flex-wrap">
                {DEPARTMENT_OPTIONS.map((dept) => {
                  const style = DEPT_STYLES[dept.id];
                  return (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => setSelectedDept(dept.id)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        selectedDept === dept.id ? style.active : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <style.icon className="w-4 h-4" />
                      {dept.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              حفظ
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold px-6 py-2.5 rounded-xl transition-all"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
        </div>
      ) : lectures.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors duration-300">
          <CalendarDays className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400">لا توجد محاضرات بعد.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {lecturesByDay.map((group) => {
            const ds = DAY_STYLES[group.day] ?? {
              header: 'bg-slate-50 dark:bg-slate-900',
              text: 'text-slate-700 dark:text-slate-200',
              badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
              cardBorder: 'border-slate-200 dark:border-slate-700',
              iconGrad: 'from-slate-500 to-slate-600',
            };
            return (
              <div key={group.day} className={`bg-white dark:bg-slate-800 rounded-2xl border ${ds.cardBorder} shadow-sm overflow-hidden transition-colors duration-300`}>
                <div className={`${ds.header} px-5 py-3 border-b ${ds.cardBorder} flex items-center gap-3`}>
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${ds.iconGrad} flex items-center justify-center shadow-sm flex-shrink-0`}>
                    <CalendarDays className="w-5 h-5 text-white" />
                  </div>
                  <h3 className={`font-bold ${ds.text}`}>{group.day}</h3>
                  {lectureCountOf(group.items) > 0 ? (
                    <span className={`mr-auto text-xs font-semibold px-2.5 py-1 rounded-full ${ds.badge}`}>
                      {lectureCountOf(group.items)} محاضرة
                    </span>
                  ) : (
                    <span className="mr-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                      إجازة
                    </span>
                  )}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {group.items.map((lecture) => {
                  const style = lecture.department ? DEPT_STYLES[lecture.department] ?? DEPT_STYLES['مشترك'] : null;
                  return (
                    <div
                      key={lecture.id}
                      className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group animate-slide-in"
                    >
                      <div className="flex items-center gap-4">
                        {lecture.is_holiday ? (
                          <div className="w-1 h-12 rounded-full bg-emerald-500" />
                        ) : (
                          <div className={`w-1 h-12 rounded-full ${style?.bar ?? 'bg-teal-500'}`} />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            {lecture.is_holiday ? (
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                                  <Coffee className="w-4 h-4 text-emerald-600" />
                                </div>
                                <h4 className="font-semibold text-emerald-700">إجازة</h4>
                              </div>
                            ) : (
                              <h4 className="font-semibold text-slate-800 dark:text-slate-100">{lecture.subject}</h4>
                            )}
                            {lecture.department && !lecture.is_holiday && style && (
                              <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                                <style.icon className="w-3 h-3" />
                                {displayDepartment(lecture.department)}
                              </span>
                            )}
                            {lecture.__pending && (
                              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                <CloudUpload className="w-3 h-3" />
                                بانتظار النشر
                              </span>
                            )}
                            {lecture.is_holiday && lecture.department && (
                              <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${DEPT_STYLES[lecture.department]?.badge ?? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                {displayDepartment(lecture.department)}
                              </span>
                            )}
                          </div>
                          {!lecture.is_holiday && (
                            <div className="flex items-center gap-4 mt-1 text-sm text-slate-500 dark:text-slate-400 flex-wrap">
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                <span>{formatTimeRange(lecture.start_time, lecture.end_time)}</span>
                              </span>
                              {lecture.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-4 h-4" />
                                  {lecture.location}
                                </span>
                              )}
                              {lecture.teacher && (
                                <span className="flex items-center gap-1">
                                  <User className="w-4 h-4" />
                                  {lecture.teacher}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {isDeveloper && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(lecture)}
                            title={lecture.__pending ? 'تعديل (لم يُنشر بعد)' : 'تعديل'}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(lecture.id)}
                            title={lecture.__pending ? 'إزالة من القائمة المحلية' : 'حذف'}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )})}
        </div>
      )}
    </div>
  );
}
