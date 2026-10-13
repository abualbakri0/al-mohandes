import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Loader2, BookOpen, CheckCircle2, Circle, Clock, Cpu, Zap, Users, Trophy, X, CloudUpload, RotateCcw } from 'lucide-react';
import { DAYS, DEPARTMENT_OPTIONS, type StudyTask, type Department } from '@/lib/supabase';
import { fetchStudyTasks, addStudyTask, updateStudyTask, deleteStudyTask, fetchStudyProgress, setStudyTaskProgress, resetStudyProgressForUser, resetAllStudyProgress, fetchStudyProgressCounts } from '@/lib/api';
import { fetchWithCache, isPendingId, updateQueuedOp, dequeue } from '@/lib/offlineStore';
import { runOrQueue } from '@/lib/offlineSync';
import { useToast } from '@/components/ToastProvider';

type Props = {
  isDeveloper: boolean;
  userId?: string;
  department?: Department;
};

const ACHIEVEMENT_MESSAGES = [
  'أحسنت! أنجزت مهمة بنجاح',
  'عمل رائع! استمر',
  'إنجاز ممتاز!',
  'ما شاء الله! تقدّمت خطوة',
  'أحسنت! واصل المذاكرة',
];

// Per-student study progress. Completion is private to each student, so it is
// NOT read from the shared `study_tasks.completed` column anymore. Instead each
// student's checkmarks live in the `study_progress` table (synced across their
// devices) with an instant local mirror in localStorage so the UI works offline
// and before the Supabase migration is applied.
//
// Weekly reset bookkeeping: a per-device week key (Saturday→Friday) decides when
// a new study week starts. When it flips, the current student's progress is
// cleared (queued if offline) so their schedule starts fresh each week.
const PROGRESS_KEY_PREFIX = 'study_progress_v1_';
const WEEK_RESET_KEY_PREFIX = 'study_tasks_week_reset_v1_';

// Maps JS getDay() (0=Sunday … 6=Saturday) to the Arabic day names used by DAYS.
const JS_DAY_TO_ARABIC = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

function progressStorageKey(userId: string): string {
  return `${PROGRESS_KEY_PREFIX}${userId}`;
}
function weekResetStorageKey(userId: string): string {
  return `${WEEK_RESET_KEY_PREFIX}${userId}`;
}

/** Read this student's local completion mirror: { [task_id]: completed }. */
function readLocalProgress(userId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(progressStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeLocalProgress(userId: string, map: Record<string, boolean>): void {
  try {
    localStorage.setItem(progressStorageKey(userId), JSON.stringify(map));
  } catch {
    /* storage unavailable — ignore */
  }
}

export default function StudyView({ isDeveloper, userId, department }: Props) {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<(StudyTask & { __pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [achievement, setAchievement] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const autoResetDone = useRef(false);
  // This student's private completion map: { [task_id]: completed }.
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  // Developer-only aggregate: how many students completed each task.
  const [progressCounts, setProgressCounts] = useState<Record<string, number>>({});

  const [subject, setSubject] = useState('');
  const [taskType, setTaskType] = useState<'review' | 'prestudy'>('review');
  const [day, setDay] = useState<string>(DAYS[0]);
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [selectedDept, setSelectedDept] = useState<Department>('ميكاترونكس');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first: fall back to snapshots instead of wiping the list.
      const t = await fetchWithCache<StudyTask>('study_tasks', department, () => fetchStudyTasks(department));
      setTasks(t.rows);

      // Per-student progress: show the local mirror instantly, then refresh
      // from the cloud (merge). The local mirror is the source of truth for
      // display, so a cloud refresh only ADDS/overwrites keys the server knows
      // about — it never wipes a locally-checked task (e.g. when the migration
      // isn't provisioned yet, fetchStudyProgress throws and we keep local).
      if (userId) {
        const local = readLocalProgress(userId);
        setProgress(local);
        if (isDeveloper) {
          fetchStudyProgressCounts()
            .then(setProgressCounts)
            .catch(() => setProgressCounts({}));
        }
        fetchStudyProgress(userId)
          .then((map) => {
            // Merge: server truth wins for keys it returns, local fills the rest.
            const merged = { ...local, ...map };
            setProgress(merged);
            writeLocalProgress(userId, merged);
          })
          .catch(() => {
            /* offline / migration missing — keep the local mirror */
          });
      }
    } finally {
      setLoading(false);
    }
  }, [department, userId, isDeveloper]);

  useEffect(() => {
    load();
  }, [load]);

  // Manual reset (developer only): clear EVERY student's progress.
  const handleReset = async () => {
    if (resetting) return;
    const confirmed = window.confirm(
      'سيتم إزالة علامات الإنجاز من جميع المهام لجميع الطلاب. هل تريد المتابعة؟'
    );
    if (!confirmed) return;
    setResetting(true);
    // Optimistic: uncheck everything locally right away.
    setProgress({});
    if (userId) writeLocalProgress(userId, {});
    try {
      const res = await runOrQueue(
        { table: 'study_progress', action: 'custom', payload: { op: 'resetAll' }, label: 'تصفير إنجازات جميع الطلاب' },
        () => resetAllStudyProgress()
      );
      if (res.status === 'queued') {
        showToast('تم التصفير محليًا', 'سيُطبّق على الجميع عند عودة الاتصال', 'info');
      } else {
        showToast('تم التصفير', 'أُزيلت علامات الإنجاز من جميع الطلاب', 'success');
      }
      await load();
    } catch {
      showToast('تعذر التصفير', 'حدث خطأ غير متوقع. حاول مرة أخرى.', 'error');
      await load();
    } finally {
      setResetting(false);
    }
  };

  // Automatic weekly reset. The app week runs Saturday→Friday (matching DAYS).
  // Each device computes a stable key for the current week; the first time it
  // sees a new key it clears the CURRENT student's progress (queued if offline)
  // so their schedule starts fresh each week. First launch just records the week.
  useEffect(() => {
    if (autoResetDone.current) return;
    autoResetDone.current = true;
    if (!userId) return;

    const key = currentWeekKey();
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(weekResetStorageKey(userId));
    } catch {
      previous = null;
    }

    // First ever launch on this device: just record the current week.
    if (previous === null) {
      try {
        localStorage.setItem(weekResetStorageKey(userId), key);
      } catch {
        /* storage unavailable — ignore */
      }
      return;
    }

    if (previous === key) return; // same week — nothing to do.

    // New week detected → clear this student's progress, then persist the key.
    void (async () => {
      try {
        await runOrQueue(
          { table: 'study_progress', action: 'custom', payload: { op: 'resetUser', userId }, label: 'تصفير أسبوعي تلقائي' },
          () => resetStudyProgressForUser(userId)
        );
      } catch {
        /* ignore — will retry next launch */
      }
      setProgress({});
      writeLocalProgress(userId, {});
      try {
        localStorage.setItem(weekResetStorageKey(userId), key);
      } catch {
        /* storage unavailable — ignore */
      }
    })();
  }, [userId]);

  const resetForm = () => {
    setSubject('');
    setHours(1);
    setMinutes(0);
    setNotes('');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (task: StudyTask) => {
    setEditingId(task.id);
    setSubject(task.subject);
    setTaskType(task.task_type);
    setDay(task.day);
    setNotes(task.notes ?? '');
    const [sh, sm] = task.start_time.split(':').map(Number);
    const [eh, em] = task.end_time.split(':').map(Number);
    let total = (eh * 60 + em) - (sh * 60 + sm);
    if (total < 0) total += 24 * 60;
    setHours(Math.floor(total / 60));
    setMinutes(total % 60);
    setSelectedDept(task.department ?? 'ميكاترونكس');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;
    if (hours === 0 && minutes === 0) return;
    setSubmitting(true);
    const totalMinutes = hours * 60 + minutes;
    const startTime = '16:00';
    const endTime = shiftTime(startTime, totalMinutes);
    const fields = {
      subject: subject.trim(),
      task_type: taskType,
      day,
      start_time: startTime,
      end_time: endTime,
      department: selectedDept,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      if (editingId) {
        // Only send `notes` when it actually changes something, so editing other
        // fields still works against a DB without the notes migration applied.
        const previous = tasks.find((t) => t.id === editingId);
        const updateFields = {
          subject: fields.subject,
          task_type: fields.task_type,
          day: fields.day,
          start_time: fields.start_time,
          end_time: fields.end_time,
          department: fields.department,
          ...(fields.notes !== null || previous?.notes ? { notes: fields.notes } : {}),
        };
        if (isPendingId(editingId)) {
          const qid = editingId.slice('pending_'.length);
          updateQueuedOp(qid, {
            payload: { ...updateFields, row: { ...(previous ?? {}), ...fields } },
            label: `تعديل مهمة (محلي): ${fields.subject}`,
          });
          showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        } else {
          const res = await runOrQueue(
            { table: 'study_tasks', action: 'update', payload: { id: editingId, fields: updateFields }, label: `تعديل مهمة: ${fields.subject}` },
            () => updateStudyTask(editingId, updateFields)
          );
          if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        }
      } else {
        const res = await runOrQueue(
          {
            table: 'study_tasks',
            action: 'insert',
            payload: {
              ...fields,
              row: { id: '', created_at: new Date().toISOString(), completed: false, ...fields },
            },
            label: `إضافة مهمة: ${fields.subject}`,
          },
          () => addStudyTask(fields.subject, fields.task_type, fields.day, fields.start_time, fields.end_time, fields.department, fields.notes)
        );
        if (res.status === 'queued') showToast('تم الحفظ محليًا', 'ستُنشر المهمة تلقائيًا عند عودة الاتصال', 'info');
      }
      resetForm();
      await load();
    } catch {
      showToast('تعذر الحفظ', 'حدث خطأ غير متوقع. حاول مرة أخرى.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, completed: boolean) => {
    if (!userId) return;
    const next = !completed;
    // Optimistic: the local mirror is the single source of truth for display
    // (offline-first). We write it immediately and NEVER revert it — even if the
    // cloud sync fails (offline, or the study_progress table isn't provisioned
    // yet). A failed write is queued and retried later, so the checkmark stays.
    setProgress((prev) => {
      const updated = { ...prev, [id]: next };
      writeLocalProgress(userId, updated);
      return updated;
    });
    if (next) {
      const msg = ACHIEVEMENT_MESSAGES[Math.floor(Math.random() * ACHIEVEMENT_MESSAGES.length)];
      setAchievement(msg);
      setTimeout(() => setAchievement(null), 3500);
    }
    // Pending (offline-created) tasks keep completion in their queued op.
    if (isPendingId(id)) {
      const qid = id.slice('pending_'.length);
      updateQueuedOp(qid, {
        payload: { completed: next, row: { ...(tasks.find((t) => t.id === id) ?? {}), completed: next } },
      });
      return;
    }
    // Fire-and-forget cloud sync. Any failure is swallowed (the local
    // checkmark already reflects the user's intent and the op is queued for
    // retry when possible), so the UI never flickers back.
    try {
      await runOrQueue(
        { table: 'study_progress', action: 'custom', payload: { op: 'set', taskId: id, userId, completed: next }, label: 'تغيير حالة مهمة' },
        () => setStudyTaskProgress(id, userId, next)
      );
    } catch {
      /* keep the local checkmark — sync will retry; no revert */
    }
  };

  const handleDelete = async (id: string) => {
    if (isPendingId(id)) {
      dequeue(id.slice('pending_'.length));
      setTasks((prev) => prev.filter((t) => t.id !== id));
      return;
    }
    try {
      const res = await runOrQueue(
        { table: 'study_tasks', action: 'delete', payload: { id }, label: 'حذف مهمة' },
        () => deleteStudyTask(id)
      );
      if (res.status === 'queued') showToast('تم الحذف محليًا', 'سيُنفّذ الحذف عند عودة الاتصال', 'info');
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // ignore
    }
  };

  // Visibility: the developer manages the whole week (all days grouped), while
  // a regular student only sees the tasks scheduled for today.
  const todayName = todayArabicDay();
  const visibleTasks = isDeveloper ? tasks : tasks.filter((t) => t.day === todayName);

  // A task is "done" for the current student when their private progress map
  // (falling back to the task's own completed flag for offline-created rows).
  const isDone = (task: StudyTask): boolean => {
    if (task.id in progress) return progress[task.id];
    return isPendingId(task.id) ? !!task.completed : false;
  };

  const completedCount = visibleTasks.filter(isDone).length;
  const progressPct = visibleTasks.length > 0 ? Math.round((completedCount / visibleTasks.length) * 100) : 0;

  const tasksByDay = DAYS.map((d) => ({
    day: d,
    items: visibleTasks
      .filter((t) => t.day === d)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6 animate-fade-in-up">
      {achievement && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-scale-in">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 max-w-sm">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <Trophy className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="font-bold text-lg">{achievement}</p>
              <p className="text-sm text-green-50">واصل التقدّم نحو أهدافك</p>
            </div>
            <button
              onClick={() => setAchievement(null)}
              className="mr-1 p-1 rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center shadow-md">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">جدول المذاكرة</h2>
            <p className="text-sm text-slate-500">
              {isDeveloper
                ? `${tasks.length} مهمة — ${completedCount} مكتملة`
                : `مهام ${todayName} — ${completedCount} من ${visibleTasks.length} مكتملة`}
            </p>
          </div>
        </div>
        {isDeveloper && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={resetting}
              title="إزالة علامات الإنجاز من جميع المهام لجميع الطلاب"
              className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2.5 rounded-xl transition-all shadow-sm disabled:opacity-60"
            >
              {resetting ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
              تصفير
            </button>
            <button
              onClick={() => {
                if (showForm) {
                  resetForm();
                } else {
                  setEditingId(null);
                  setShowForm(true);
                }
              }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
            >
              <Plus className="w-5 h-5" />
              إضافة مهمة
            </button>
          </div>
        )}
      </div>

      {visibleTasks.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span className="font-bold text-slate-700">تقدّمك</span>
            </div>
            <span className="text-sm font-bold text-indigo-600">{progressPct}%</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              {completedCount} مكتملة
            </span>
            <span className="flex items-center gap-1.5">
              <Circle className="w-4 h-4 text-slate-300" />
              {visibleTasks.length - completedCount} متبقية
            </span>
          </div>
        </div>
      )}

      {showForm && isDeveloper && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 animate-scale-in"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">المادة</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="اسم المادة"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">النوع</label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as 'review' | 'prestudy')}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all bg-white"
              >
                <option value="review">مراجعة (ما تم أخذه)</option>
                <option value="prestudy">مذاكرة (استعداد)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">اليوم</label>
              <select
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all bg-white"
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">عدد الساعات</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setHours((h) => Math.max(0, h - 1))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 font-bold text-xl text-slate-700 transition-colors touch-manipulation select-none"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={0}
                    max={12}
                    value={hours}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '');
                      if (v === '') { setHours(0); return; }
                      setHours(Math.max(0, Math.min(12, Number(v))));
                    }}
                    className="w-14 text-center px-2 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all font-bold text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setHours((h) => Math.min(12, h + 1))}
                    className="w-10 h-10 rounded-xl bg-indigo-100 hover:bg-indigo-200 active:bg-indigo-300 font-bold text-xl text-indigo-700 transition-colors touch-manipulation select-none"
                  >
                    +
                  </button>
                  <span className="text-sm text-slate-500">ساعة</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMinutes((m) => Math.max(0, m - 5))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 font-bold text-xl text-slate-700 transition-colors touch-manipulation select-none"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={minutes}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '');
                      if (v === '') { setMinutes(0); return; }
                      setMinutes(Math.max(0, Math.min(59, Number(v))));
                    }}
                    className="w-14 text-center px-2 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all font-bold text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setMinutes((m) => Math.min(59, m + 5))}
                    className="w-10 h-10 rounded-xl bg-indigo-100 hover:bg-indigo-200 active:bg-indigo-300 font-bold text-xl text-indigo-700 transition-colors touch-manipulation select-none"
                  >
                    +
                  </button>
                  <span className="text-sm text-slate-500">دقيقة</span>
                </div>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">القسم</label>
              <div className="flex gap-2">
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => setSelectedDept(dept.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      selectedDept === dept.id
                        ? dept.id === 'ميكاترونكس' ? 'bg-cyan-100 text-cyan-700 ring-2 ring-cyan-400' : dept.id === 'كهربائية' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400' : 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {dept.id === 'ميكاترونكس' ? <Cpu className="w-4 h-4" /> : dept.id === 'كهربائية' ? <Zap className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    {dept.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                الشرح <span className="text-slate-400 font-normal">(اختياري)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="اكتب شرحًا للمهمة يظهر للطلاب أسفل اسم المادة…"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all resize-y leading-relaxed"
              />
              <p className="mt-1 text-xs text-slate-400">سيظهر هذا الشرح للطالب أسفل اسم المادة.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              حفظ
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-6 py-2.5 rounded-xl transition-all"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">
            {isDeveloper ? 'لا توجد مهام مذاكرة بعد.' : `لا توجد مهام مذاكرة ليوم ${todayName}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasksByDay.map((group) => (
            <div key={group.day} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-5 py-3 border-b border-slate-200">
                <h3 className="font-bold text-slate-700">{group.day}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {group.items.map((task) => {
                  const taskHours = getDurationHours(task.start_time, task.end_time);
                  const done = isDone(task);
                  return (
                    <div
                      key={task.id}
                      className={`flex items-center justify-between px-5 py-4 transition-colors group animate-slide-in ${
                        done ? 'bg-green-50/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handleToggle(task.id, done)}
                          className="flex-shrink-0 transition-transform hover:scale-110"
                        >
                          {done ? (
                            <CheckCircle2 className="w-6 h-6 text-green-500" />
                          ) : (
                            <Circle className="w-6 h-6 text-slate-300 hover:text-indigo-400" />
                          )}
                        </button>
                        <div className={`w-1 h-12 rounded-full ${task.task_type === 'review' ? 'bg-indigo-500' : 'bg-purple-500'}`} />
                        <div>
                          <h4 className={`font-semibold text-slate-800 ${done ? 'line-through opacity-60' : ''}`}>
                            {task.subject}
                          </h4>
                          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {taskHours}
                            </span>
                            <span
                              className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                                task.task_type === 'review'
                                  ? 'bg-indigo-100 text-indigo-600'
                                  : 'bg-purple-100 text-purple-600'
                              }`}
                            >
                              {task.task_type === 'review' ? 'مراجعة' : 'مذاكرة'}
                            </span>
                            {task.__pending && (
                              <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                <CloudUpload className="w-3 h-3" />
                                بانتظار النشر
                              </span>
                            )}
                            {done && (
                              <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                                <Trophy className="w-3.5 h-3.5" />
                                مُنجز
                              </span>
                            )}
                            {isDeveloper && (progressCounts[task.id] ?? 0) > 0 && (
                              <span
                                className="flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-600"
                                title="عدد الطلاب الذين أكملوا هذه المهمة"
                              >
                                <Users className="w-3 h-3" />
                                أكملها {progressCounts[task.id]}
                              </span>
                            )}
                          </div>
                          {task.notes && (
                            <div className="mt-2 flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                              <BookOpen className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                              <p className="text-sm text-slate-600 whitespace-pre-wrap break-words leading-relaxed">
                                {task.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      {isDeveloper && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(task)}
                            title={task.__pending ? 'تعديل (لم يُنشر بعد)' : 'تعديل'}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(task.id)}
                            title={task.__pending ? 'إزالة من القائمة المحلية' : 'حذف'}
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
          ))}
        </div>
      )}
    </div>
  );
}

function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function getDurationHours(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let totalMin = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMin < 0) totalMin += 24 * 60;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} ساعة و ${m} دقيقة`;
  if (h > 0) return `${h} ساعة`;
  return `${m} دقيقة`;
}

/** Arabic name of today (e.g. 'الثلاثاء') — matches the DAYS values. */
function todayArabicDay(): string {
  return JS_DAY_TO_ARABIC[new Date().getDay()];
}

/**
 * Stable key for the current app week (Saturday→Friday). We anchor on the most
 * recent Saturday so the value flips exactly when the study week rolls over.
 * Returned as YYYY-MM-DD of that Saturday.
 */
function currentWeekKey(): string {
  const now = new Date();
  // getDay(): 0=Sun … 6=Sat. Days since last Saturday:
  // Sat(6)→0, Sun(0)→1, Mon(1)→2, … Fri(5)→6.
  const daysSinceSaturday = (now.getDay() + 1) % 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() - daysSinceSaturday);
  const y = sat.getFullYear();
  const m = String(sat.getMonth() + 1).padStart(2, '0');
  const d = String(sat.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
