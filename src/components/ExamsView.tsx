import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, FileText, Clock, MapPin, Calendar, Cpu, Zap, AlertCircle, Users, User, CloudUpload } from 'lucide-react';
import { DEPARTMENT_OPTIONS, displayDepartment, type Exam, type Department } from '@/lib/supabase';
import { formatTimeRange } from '@/lib/time';
import { fetchExams, addExam, updateExam, deleteExam } from '@/lib/api';
import { fetchWithCache, isPendingId, updateQueuedOp, dequeue } from '@/lib/offlineStore';
import { runOrQueue } from '@/lib/offlineSync';
import { useToast } from '@/components/ToastProvider';

type Props = {
  isDeveloper: boolean;
  department?: Department;
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function getDaysLeft(examDate: string): number {
  const due = new Date(examDate);
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function ExamsView({ isDeveloper, department }: Props) {
  const { showToast } = useToast();
  const [exams, setExams] = useState<(Exam & { __pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [location, setLocation] = useState('');
  const [teacher, setTeacher] = useState('');
  const [selectedDept, setSelectedDept] = useState<Department>('ميكاترونكس');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first: show the cached snapshot when the network is down.
      const res = await fetchWithCache<Exam>('exams', department, () => fetchExams(department));
      setExams(res.rows);
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
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (exam: Exam) => {
    setEditingId(exam.id);
    setSubject(exam.subject);
    setExamDate(exam.exam_date);
    setStartTime(exam.start_time);
    setEndTime(exam.end_time);
    setLocation(exam.location ?? '');
    setTeacher(exam.teacher ?? '');
    setSelectedDept(exam.department ?? 'ميكاترونكس');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;
    setSubmitting(true);
    const fields = {
      subject: subject.trim(),
      exam_date: examDate,
      start_time: startTime,
      end_time: endTime,
      location: location.trim(),
      department: selectedDept,
      teacher: teacher.trim(),
    };
    try {
      if (editingId) {
        if (isPendingId(editingId)) {
          const qid = editingId.slice('pending_'.length);
          updateQueuedOp(qid, {
            payload: { ...fields, row: { ...(exams.find((x) => x.id === editingId) ?? {}), ...fields } },
            label: `تعديل اختبار (محلي): ${fields.subject}`,
          });
          showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        } else {
          const res = await runOrQueue(
            { table: 'exams', action: 'update', payload: { id: editingId, fields }, label: `تعديل اختبار: ${fields.subject}` },
            () => updateExam(editingId, fields)
          );
          if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
          else showToast('تم التعديل بنجاح', `تم تحديث اختبار «${fields.subject}»`, 'success');
        }
      } else {
        const res = await runOrQueue(
          {
            table: 'exams',
            action: 'insert',
            payload: {
              ...fields,
              row: { id: '', created_at: new Date().toISOString(), ...fields },
            },
            label: `إضافة اختبار: ${fields.subject}`,
          },
          () => addExam(fields.subject, fields.exam_date, fields.start_time, fields.end_time, fields.location, fields.department, fields.teacher)
        );
        if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُنشر الاختبار تلقائيًا عند عودة الاتصال', 'info');
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
      dequeue(id.slice('pending_'.length));
      setExams((prev) => prev.filter((e) => e.id !== id));
      return;
    }
    try {
      const res = await runOrQueue(
        { table: 'exams', action: 'delete', payload: { id }, label: 'حذف اختبار' },
        () => deleteExam(id)
      );
      if (res.status === 'queued') showToast('تم الحذف محليًا', 'سيُنفّذ الحذف عند عودة الاتصال', 'info');
      setExams((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center shadow-md">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">جدول الاختبارات</h2>
            <p className="text-sm text-slate-500">{exams.length} اختبار مجدول</p>
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
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <Plus className="w-5 h-5" />
            إضافة اختبار
          </button>
        )}
      </div>

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
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">تاريخ الاختبار</label>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">من الساعة</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">إلى الساعة</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">المكان (اختياري)</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="قاعة الاختبار"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">المدرس (اختياري)</label>
              <input
                type="text"
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
                placeholder="اسم المدرس"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">القسم</label>
              <div className="flex gap-2">
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => setSelectedDept(dept.id)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
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
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
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
          <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
        </div>
      ) : exams.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">لا توجد اختبارات مجدولة بعد.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {exams.map((exam) => {
            const daysLeft = getDaysLeft(exam.exam_date);
            const isPast = daysLeft < 0;
            const isSoon = daysLeft >= 0 && daysLeft <= 7;

            return (
              <div
                key={exam.id}
                className={`bg-white rounded-2xl border-2 shadow-sm p-5 transition-all group animate-slide-in ${
                  isPast
                    ? 'border-slate-200 opacity-50'
                    : isSoon
                    ? 'border-rose-300'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white font-bold ${
                      isPast ? 'bg-slate-400' : isSoon ? 'bg-rose-500' : 'bg-teal-500'
                    }`}>
                      <Calendar className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">{exam.subject}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{formatDate(exam.exam_date)}</p>
                      {exam.__pending && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 mt-1">
                          <CloudUpload className="w-3 h-3" />
                          بانتظار النشر
                        </span>
                      )}
                    </div>
                  </div>
                  {isDeveloper && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(exam)}
                        title={exam.__pending ? 'تعديل (لم يُنشر بعد)' : 'تعديل'}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(exam.id)}
                        title={exam.__pending ? 'إزالة من القائمة المحلية' : 'حذف'}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-3 text-sm text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>{formatTimeRange(exam.start_time, exam.end_time)}</span>
                  </span>
                  {exam.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {exam.location}
                    </span>
                  )}
                  {exam.teacher && (
                    <span className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {exam.teacher}
                    </span>
                  )}
                  {exam.department && (
                    <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      exam.department === 'ميكاترونكس' ? 'bg-cyan-100 text-cyan-700' : exam.department === 'كهربائية' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {exam.department === 'ميكاترونكس' ? <Cpu className="w-3 h-3" /> : exam.department === 'كهربائية' ? <Zap className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                      {displayDepartment(exam.department)}
                    </span>
                  )}
                </div>

                {!isPast && (
                  <div className={`mt-3 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full inline-flex w-fit ${
                    isSoon ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isSoon && <AlertCircle className="w-3.5 h-3.5" />}
                    {daysLeft === 0 ? 'الاختبار اليوم!' : `باقي ${daysLeft} يوم`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
