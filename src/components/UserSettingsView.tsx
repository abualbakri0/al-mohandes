import { useState, useEffect } from 'react';
import { KeyRound, Loader2, CheckCircle2, Lock, ShieldCheck, User as UserIcon, Phone, Bell, BellRing, MoonStar, BookOpenCheck } from 'lucide-react';
import { changeOwnPassword } from '@/lib/api';
import { getNotificationPrefs, setNotificationPrefs, type NotificationPrefs } from '@/lib/notificationPrefs';
import { requestNativePermission, isNativePermissionGranted } from '@/lib/nativeNotifications';
import { sendTestNotification } from '@/hooks/useLectureReminders';
import type { Registration } from '@/lib/supabase';

function PrefToggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${checked ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'}`}
        aria-pressed={checked}
      >
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-0.5' : 'right-0.5'}`} />
      </button>
    </div>
  );
}

function NotificationSettingsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => getNotificationPrefs());
  const [granted, setGranted] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    isNativePermissionGranted().then(setGranted).catch(() => setGranted(false));
  }, []);

  const update = (patch: Partial<NotificationPrefs>) => {
    setPrefs(setNotificationPrefs(patch));
  };

  const handleEnable = async () => {
    const ok = await requestNativePermission();
    setGranted(ok);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await sendTestNotification();
    } finally {
      setTimeout(() => setTesting(false), 1500);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
      <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1">
        <BellRing className="w-4 h-4 text-teal-500" />
        الإشعارات الرسمية
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2">
        🔔 إشعارات رسمية تظهر في شريط النظام — حتى والتطبيق مصغّر — مع صوت واهتزاز. الضغط عليها يفتح القسم المناسب.
      </p>

      {granted === false && (
        <button
          type="button"
          onClick={handleEnable}
          className="w-full mt-2 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-xl transition-all text-sm"
        >
          <Bell className="w-4 h-4" />
          تفعيل الإشعارات الرسمية
        </button>
      )}
      {granted === true && (
        <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" /> الإشعارات الرسمية مفعّلة على هذا الجهاز
        </p>
      )}

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <PrefToggle
          label="تنبيهات المحتوى الجديد"
          desc="محاضرة، تكليف، اختبار، مرجع، أو إشعار من المطور (وللمطور: مسجل جديد ورسائل التواصل)"
          checked={prefs.contentAlerts}
          onChange={(v) => update({ contentAlerts: v })}
        />
        <PrefToggle
          label="التذكير قبل المحاضرات"
          desc="تنبيه قبل المحاضرة بساعة وآخر قبلها بربع ساعة"
          checked={prefs.lectureReminders}
          onChange={(v) => update({ lectureReminders: v })}
        />
        <PrefToggle
          label="تذكير المساء 🌙"
          desc="ملخص يومي الساعة 7 مساءً بمحاضرات الغد"
          checked={prefs.eveningSummary}
          onChange={(v) => update({ eveningSummary: v })}
        />
        <PrefToggle
          label="تحفيز المذاكرة 📚"
          desc="رسالة تحفيزية للساعة 4 عصراً كل يوم (تتغير يومياً)"
          checked={prefs.studyMotivation}
          onChange={(v) => update({ studyMotivation: v })}
        />
        <PrefToggle
          label="تذكير تسليم التكاليف ⏰"
          desc="تنبيه الساعة 8 مساءً قبل موعد التسليم بيوم — حتى للتكاليف المنجزة"
          checked={prefs.assignmentReminders}
          onChange={(v) => update({ assignmentReminders: v })}
        />
      </div>

      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="w-full mt-1 flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-2.5 rounded-xl transition-all text-sm disabled:opacity-60"
      >
        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoonStar className="w-4 h-4" />}
        جرّب إشعاراً الآن
      </button>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
        <BookOpenCheck className="w-3 h-3" /> الأسماء تظهر (الأول + الأخير) فقط حفاظاً على الخصوصية
      </p>
    </div>
  );
}

export default function UserSettingsView({ user }: { user: Registration }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 4) {
      setError('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين');
      return;
    }

    setSaving(true);
    try {
      const res = await changeOwnPassword(user.id, user.phone, currentPassword, newPassword);
      if (res.ok) {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(res.error ?? 'حدث خطأ. حاول مرة أخرى.');
      }
    } catch {
      setError('حدث خطأ. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center shadow-md">
          <ShieldCheck className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">إعداداتي</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">إدارة كلمة مرور حسابك</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-teal-500" />
          بيانات الحساب
        </h3>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">الاسم:</span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{user.name}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Phone className="w-3.5 h-3.5" /> رقم الهاتف:
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-200" dir="ltr">{user.phone}</span>
        </div>
      </div>
      <form onSubmit={handleChange} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center">
            <KeyRound className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100">تغيير كلمة المرور</h3>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 rounded-lg px-3 py-2">
          🔒 كلمة المرور تحمي حسابك — لا يستطيع أي طالب الدخول برقم هاتفك بدونها. غيّرها متى شئت.
        </p>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">كلمة المرور الحالية</label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="أدخل كلمة مرورك الحالية"
              className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
              dir="ltr"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">كلمة المرور الجديدة</label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="4 أحرف على الأقل"
              className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
              dir="ltr"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">تأكيد كلمة المرور الجديدة</label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="أعد كتابة كلمة المرور الجديدة"
              className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
              dir="ltr"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-sm rounded-lg px-4 py-2.5">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            تم تغيير كلمة المرور بنجاح
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          تحديث كلمة المرور
        </button>
      </form>
    </div>
  );
}

