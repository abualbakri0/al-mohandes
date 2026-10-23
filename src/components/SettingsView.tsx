import { useState, useEffect, useCallback } from 'react';
import { Settings, Loader2, Save, KeyRound, GraduationCap, Calendar, CheckCircle2 } from 'lucide-react';
import { ACADEMIC_LEVELS, SEMESTERS, type AppSettings } from '@/lib/supabase';
import { changeDevCode, fetchSettings, updateSettings } from '@/lib/api';
import PushStatusCard from '@/components/PushStatusCard';

export default function SettingsView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [level, setLevel] = useState('');
  const [semester, setSemester] = useState('');
  const [semesterStartDate, setSemesterStartDate] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSettings();
      setSettings(s);
      if (s) {
        setLevel(s.academic_level);
        setSemester(s.semester);
        setSemesterStartDate(s.semester_start_date ?? '');
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings({ academic_level: level, semester, semester_start_date: semesterStartDate || null });
      setSettings((prev) => prev ? { ...prev, academic_level: level, semester, semester_start_date: semesterStartDate || null } : prev);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    if (!currentPassword.trim()) {
      setPasswordError('الرجاء إدخال الرمز الحالي');
      return;
    }
    if (!newPassword.trim()) {
      setPasswordError('الرجاء إدخال الرمز الجديد');
      return;
    }
    if (newPassword.trim().length < 4) {
      setPasswordError('الرمز الجديد يجب أن يكون 4 أحرف على الأقل');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('الرمزان غير متطابقين');
      return;
    }
    setSaving(true);
    try {
      const ok = await changeDevCode(currentPassword.trim(), newPassword.trim());
      if (!ok) {
        setPasswordError('الرمز الحالي غير صحيح');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setPasswordError('حدث خطأ. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-md">
          <Settings className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">إعدادات البرنامج</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">تحكم في المستوى الجامعي والترم ورمز المطور</p>
        </div>
      </div>

      {saved && (
        <div className="bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 text-sm rounded-xl px-4 py-3 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4" />
          تم حفظ التغييرات بنجاح
        </div>
      )}

      {/* حالة إشعارات هذا الجهاز (مطوّر): يكشف «لا يصلني إشعار تسجيل جديد» */}
      <PushStatusCard isDeveloper />

      {/* Academic Level & Semester */}
        <div className="bg-white dark:bg-slate-950 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-teal-600" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100">المستوى الجامعي والترم</h3>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">المستوى</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all bg-white dark:bg-black"
          >
            {ACADEMIC_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">الترم</label>
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all bg-white dark:bg-black"
          >
            {SEMESTERS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">تاريخ بداية الفصل الدراسي</label>
          <input
            type="date"
            value={semesterStartDate}
            onChange={(e) => setSemesterStartDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
          />
          <p className="text-xs text-slate-400 dark:text-slate-400 mt-1.5">يتم حساب رقم الأسبوع تلقائياً من هذا التاريخ في الواجهة الرئيسية</p>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ
        </button>
      </div>

      {/* Developer Password */}
        <div className="bg-white dark:bg-slate-950 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center">
            <KeyRound className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100">تغيير رمز المطور</h3>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">الرمز الحالي</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="أدخل الرمز الحالي أولاً"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
            dir="ltr"
          />
          <p className="text-xs text-slate-400 dark:text-slate-400 mt-1.5">يتحقق السيرفر من الرمز الحالي قبل أي تغيير — يبطل التغيير كل التوكنات القديمة</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">الرمز الجديد</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="أدخل الرمز الجديد"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
            dir="ltr"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">تأكيد الرمز</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="أعد إدخال الرمز"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
            dir="ltr"
          />
        </div>

        {passwordError && (
          <div className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-sm rounded-lg px-4 py-2.5">
            {passwordError}
          </div>
        )}

        <button
          onClick={handleChangePassword}
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          تحديث الرمز
        </button>
      </div>

      {/* Current Settings Display */}
      {settings && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-teal-400" />
            <h3 className="font-bold">الإعدادات الحالية</h3>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">المستوى الحالي:</span>
            <span className="font-medium text-teal-300">{settings.academic_level}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">الترم الحالي:</span>
            <span className="font-medium text-teal-300">{settings.semester}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">بداية الفصل:</span>
            <span className="font-medium text-teal-300">{settings.semester_start_date ?? 'غير محدد'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">رمز المطور:</span>
            <span className="font-mono text-amber-400">••••••</span>
          </div>
        </div>
      )}
    </div>
  );
}
