import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, ClipboardList, CheckCircle2, Circle, Calendar, AlertTriangle, Cpu, Zap, Users, Trophy, X, CloudUpload } from 'lucide-react';
import { DEPARTMENT_OPTIONS, displayDepartment, type Assignment, type Department } from '@/lib/supabase';
import { fetchAssignments, addAssignment, updateAssignment, deleteAssignment, fetchAssignmentProgress, setAssignmentProgress, fetchAssignmentProgressCounts } from '@/lib/api';
import { fetchWithCache, isPendingId, updateQueuedOp, dequeue } from '@/lib/offlineStore';
import { runOrQueue } from '@/lib/offlineSync';
import { useToast } from '@/components/ToastProvider';

type Props = {
  isDeveloper: boolean;
  userId?: string;
  department?: Department;
};

const ACHIEVEMENT_MESSAGES = [
  'أحسنت! أكملت التكليف بنجاح',
  'عمل رائع! استمر',
  'إنجاز ممتاز!',
  'ما شاء الله! تقدّمت خطوة',
  'أحسنت! واصل التقدّم',
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

// أسماء الأيام مرتبة حسب Date#getDay() (0 = الأحد ... 6 = السبت)، وهي نفس
// أسماء DAYS في supabase.ts لكن بترتيب تقويمي يطابق getDay مباشرة.
const WEEKDAY_BY_INDEX = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** اسم اليوم بالعربية لتاريخ بصيغة YYYY-MM-DD (يُقرأ كتاريخ محلي دون انزياح UTC). */
function formatWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAY_BY_INDEX[d.getDay()];
}

/** Local YYYY-MM-DD (no UTC shift). */
function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default due date = same weekday of next week (request date + 7 days). */
function defaultDueFor(requestYMD: string): string {
  const d = new Date(`${requestYMD}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const t = new Date();
    t.setDate(t.getDate() + 7);
    return toLocalYMD(t);
  }
  d.setDate(d.getDate() + 7);
  return toLocalYMD(d);
}

function getDaysLeft(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// Per-student assignment progress. Completion is private to each student, so it
// is NOT read from the shared `assignments.completed` column anymore. Instead
// each student's checkmarks live in the `assignment_progress` table (synced
// across their devices) with an instant local mirror in localStorage so the UI
// works offline and before the Supabase migration is applied.
const PROGRESS_KEY_PREFIX = 'assignment_progress_v1_';

function progressStorageKey(userId: string): string {
  return `${PROGRESS_KEY_PREFIX}${userId}`;
}

/** Read this student's local completion mirror: { [assignment_id]: completed }. */
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

export default function AssignmentsView({ isDeveloper, userId, department }: Props) {
  const { showToast } = useToast();
  const [assignments, setAssignments] = useState<(Assignment & { __pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [achievement, setAchievement] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // This student's private completion map: { [assignment_id]: completed }.
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  // Developer-only aggregate: how many students completed each assignment.
  const [progressCounts, setProgressCounts] = useState<Record<string, number>>({});

  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [requestDate, setRequestDate] = useState(() => toLocalYMD(new Date()));
  const [dueDate, setDueDate] = useState(() => defaultDueFor(toLocalYMD(new Date())));
  // Tracks whether the developer manually edited the due date (so changing
  // the request date no longer auto-overwrites it).
  const [dueTouched, setDueTouched] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department>('ميكاترونكس');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first: keeps last known assignments when the network fails.
      const res = await fetchWithCache<Assignment>('assignments', department, () => fetchAssignments(department));
      setAssignments(res.rows);

      // Per-student progress: show the local mirror instantly, then refresh
      // from the cloud (merge). The local mirror is the source of truth for
      // display, so a cloud refresh only ADDS/overwrites keys the server knows
      // about — it never wipes a locally-checked assignment (e.g. when the
      // migration isn't provisioned yet, fetchAssignmentProgress throws and we
      // keep local).
      if (userId) {
        const local = readLocalProgress(userId);
        setProgress(local);
        if (isDeveloper) {
          fetchAssignmentProgressCounts()
            .then(setProgressCounts)
            .catch(() => setProgressCounts({}));
        }
        fetchAssignmentProgress(userId)
          .then((map) => {
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

  const resetForm = () => {
    setSubject('');
    setTitle('');
    setEditingId(null);
    setShowForm(false);
    setDueTouched(false);
    const today = toLocalYMD(new Date());
    setRequestDate(today);
    setDueDate(defaultDueFor(today));
  };

  const startEdit = (assignment: Assignment) => {
    setEditingId(assignment.id);
    setSubject(assignment.subject);
    setTitle(assignment.title);
    setRequestDate(assignment.request_date);
    setDueDate(assignment.due_date);
    setDueTouched(true); // don't auto-overwrite the stored due date while editing
    setSelectedDept(assignment.department ?? 'ميكاترونكس');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !title.trim()) return;
    setSubmitting(true);
    const fields = {
      subject: subject.trim(),
      title: title.trim(),
      request_date: requestDate,
      due_date: dueDate,
      department: selectedDept,
    };
    try {
      if (editingId) {
        if (isPendingId(editingId)) {
          const qid = editingId.slice('pending_'.length);
          updateQueuedOp(qid, {
            payload: { ...fields, row: { ...(assignments.find((a) => a.id === editingId) ?? {}), ...fields } },
            label: `تعديل تكليف (محلي): ${fields.title}`,
          });
          showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        } else {
          const res = await runOrQueue(
            { table: 'assignments', action: 'update', payload: { id: editingId, fields }, label: `تعديل تكليف: ${fields.title}` },
            () => updateAssignment(editingId, fields)
          );
          if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        }
      } else {
        const res = await runOrQueue(
          {
            table: 'assignments',
            action: 'insert',
            payload: {
              ...fields,
              row: { id: '', created_at: new Date().toISOString(), completed: false, ...fields },
            },
            label: `إضافة تكليف: ${fields.title}`,
          },
          () => addAssignment(fields.subject, fields.title, fields.request_date, fields.due_date, fields.department)
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
    // cloud sync fails (offline, or the assignment_progress table isn't
    // provisioned yet). A failed write is queued and retried later.
    setProgress((prev) => {
      const updated = { ...prev, [id]: next };
      writeLocalProgress(userId, updated);
      return updated;
    });
    if (!completed) {
      const msg = ACHIEVEMENT_MESSAGES[Math.floor(Math.random() * ACHIEVEMENT_MESSAGES.length)];
      setAchievement(msg);
      setTimeout(() => setAchievement(null), 3500);
    }
    if (isPendingId(id)) {
      // Still queued — the checkmark lives only in the local progress mirror
      // (already written above, keyed by this pending id). We must NOT write
      // the shared `completed` flag, or every student would see the checkmark.
      // When the insert finally syncs it gets a real id; the progress row is
      // queued below under that pending id and re-keyed on the next load.
      const qid = id.slice('pending_'.length);
      updateQueuedOp(qid, {
        payload: { row: { ...(assignments.find((a) => a.id === id) ?? {}) } },
      });
      await runOrQueue(
        { table: 'assignment_progress', action: 'custom', payload: { op: 'set', assignmentId: id, userId, completed: next }, label: 'تغيير حالة تكليف' },
        () => setAssignmentProgress(id, userId, next)
      );
      return;
    }
    try {
      await runOrQueue(
        { table: 'assignment_progress', action: 'custom', payload: { op: 'set', assignmentId: id, userId, completed: next }, label: 'تغيير حالة تكليف' },
        () => setAssignmentProgress(id, userId, next)
      );
    } catch {
      // keep the local checkmark: sync will retry, no revert
      if (!completed) {
        const msg = ACHIEVEMENT_MESSAGES[Math.floor(Math.random() * ACHIEVEMENT_MESSAGES.length)];
        setAchievement(msg);
        setTimeout(() => setAchievement(null), 3500);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (isPendingId(id)) {
      dequeue(id.slice('pending_'.length));
      setAssignments((prev) => prev.filter((a) => a.id !== id));
      return;
    }
    try {
      const res = await runOrQueue(
        { table: 'assignments', action: 'delete', payload: { id }, label: 'حذف تكليف' },
        () => deleteAssignment(id)
      );
      if (res.status === 'queued') showToast('تم الحذف محليًا', 'سيُنفّذ الحذف عند عودة الاتصال', 'info');
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // ignore
    }
  };

  // A task is "done" ONLY for the current student, and ONLY from their own
  // private progress map. We deliberately never fall back to the shared
  // `assignments.completed` column: that column is global, so reading it made
  // one student's checkmark appear for everyone.
  const isDone = (a: Assignment): boolean => {
    return progress[a.id] === true;
  };

  const completedCount = assignments.filter((a) => isDone(a)).length;
  const progressPct = assignments.length > 0 ? Math.round((completedCount / assignments.length) * 100) : 0;

  // ترتيب تلقائي: غير المكتمل في الأعلى والمكتمل ينزل للأسفل مباشرة عند الضغط
  // على "صح"، وداخل كل مجموعة يُحفظ الترتيب حسب تاريخ التسليم (الأقرب أولاً).
  // الملاحظة: البطاقات لها key = assignment.id، فينقل React العقدة نفسها دون
  // إعادة تشغيل الحركة (animate-slide-in)، فلا يوجد وميض عند إعادة الترتيب.
  const sorted = [...assignments].sort((a, b) => {
    const aDone = isDone(a) ? 1 : 0;
    const bDone = isDone(b) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

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
          <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-md">
            <ClipboardList className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">التكاليف</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{assignments.length} تكليف — {completedCount} مكتمل</p>
          </div>
        </div>
        {isDeveloper && (
          <button
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                const todayAuto = toLocalYMD(new Date());
                setRequestDate(todayAuto);
                setDueDate(defaultDueFor(todayAuto));
                setDueTouched(false);
                setEditingId(null);
                setShowForm(true);
              }
            }}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <Plus className="w-5 h-5" />
            إضافة تكليف
          </button>
        )}
      </div>

      {assignments.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span className="font-bold text-slate-700 dark:text-slate-200">تقدّمك</span>
            </div>
            <span className="text-sm font-bold text-amber-600">{progressPct}%</span>
          </div>
          <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-3 text-sm text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              {completedCount} مكتمل
            </span>
            <span className="flex items-center gap-1.5">
              <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600" />
              {assignments.length - completedCount} متبقي
            </span>
          </div>
        </div>
      )}

      {showForm && isDeveloper && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 animate-scale-in transition-colors duration-300"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">المادة</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="اسم المادة"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">عنوان التكليف</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="عنوان التكليف"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">تاريخ الطلب</label>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => { setRequestDate(e.target.value); if (!dueTouched) setDueDate(defaultDueFor(e.target.value)); }}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">آخر يوم للتسليم</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => { setDueDate(e.target.value); setDueTouched(true); }}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">القسم</label>
              <div className="flex gap-2">
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => setSelectedDept(dept.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      selectedDept === dept.id
                        ? dept.id === 'ميكاترونكس' ? 'bg-cyan-100 text-cyan-700 ring-2 ring-cyan-400' : dept.id === 'كهربائية' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400' : 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {dept.id === 'ميكاترونكس' ? <Cpu className="w-4 h-4" /> : dept.id === 'كهربائية' ? <Zap className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    {dept.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
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
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <ClipboardList className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400">لا توجد تكاليف بعد.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sorted.map((assignment) => {
            const daysLeft = getDaysLeft(assignment.due_date);
            const done = isDone(assignment);
            const isOverdue = daysLeft < 0 && !done;
            const isUrgent = daysLeft >= 0 && daysLeft <= 2 && !done;
            const doneCount = isDeveloper ? (progressCounts[assignment.id] ?? 0) : 0;

            return (
              <div
                key={assignment.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm p-5 transition-colors duration-300 group animate-slide-in ${
                  done
                    ? 'border-slate-200 dark:border-slate-700 opacity-60'
                    : isOverdue
                    ? 'border-red-200 dark:border-red-900'
                    : isUrgent
                    ? 'border-amber-300 dark:border-amber-800'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-4">
                  <button
                    onClick={() => handleToggle(assignment.id, done)}
                    className="mt-0.5 flex-shrink-0 transition-transform hover:scale-110"
                  >
                    {done ? (
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                    ) : (
                      <Circle className="w-6 h-6 text-slate-300 dark:text-slate-600 hover:text-amber-400" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* اسم المادة بارز في الأعلى، وتحته شرح التكليف */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className={`font-bold text-slate-800 dark:text-slate-100 ${done ? 'line-through' : ''}`}>
                        {assignment.subject}
                      </h4>
                      {isDeveloper && doneCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          <Trophy className="w-3 h-3" />
                          أكملها {doneCount}
                        </span>
                      )}
                      {assignment.department && (
                        <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          assignment.department === 'ميكاترونكس' ? 'bg-cyan-100 text-cyan-700' : assignment.department === 'كهربائية' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {assignment.department === 'ميكاترونكس' ? <Cpu className="w-3 h-3" /> : assignment.department === 'كهربائية' ? <Zap className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                          {displayDepartment(assignment.department)}
                        </span>
                      )}
                    </div>
                    <p className={`text-sm text-slate-600 dark:text-slate-300 mt-0.5 ${done ? 'line-through' : ''}`}>{assignment.title}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                        <Calendar className="w-4 h-4" />
                        الطلب: {formatDate(assignment.request_date)}
                        {assignment.request_date && (
                          <span className="text-teal-600 dark:text-teal-400 font-medium">
                            ({formatWeekday(assignment.request_date)})
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                        <Calendar className="w-4 h-4" />
                        التسليم: {formatDate(assignment.due_date)}
                        {assignment.due_date && (
                          <span className="text-teal-600 dark:text-teal-400 font-medium">
                            ({formatWeekday(assignment.due_date)})
                          </span>
                        )}
                      </span>
                      {!done && (
                        <span
                          className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                            isOverdue
                              ? 'bg-red-100 dark:bg-red-900/50 text-red-600'
                              : isUrgent
                              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-600'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {isOverdue ? (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5" />
                              متأخر {-daysLeft} يوم
                            </>
                          ) : daysLeft === 0 ? (
                            'التسليم اليوم'
                          ) : (
                            `باقي ${daysLeft} يوم`
                          )}
                        </span>
                      )}
                      {done && (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                          <Trophy className="w-3.5 h-3.5" />
                          مُنجز
                        </span>
                      )}
                    </div>
                  </div>

                  {isDeveloper && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(assignment)}
                        title={assignment.__pending ? 'تعديل (لم يُنشر بعد)' : 'تعديل'}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(assignment.id)}
                        title={assignment.__pending ? 'إزالة من القائمة المحلية' : 'حذف'}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
