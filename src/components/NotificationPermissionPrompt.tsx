import { useState, useEffect } from 'react';
import { BellRing, X } from 'lucide-react';
import {
  requestNativePermission,
  isNativePermissionGranted,
} from '@/lib/nativeNotifications';

const DISMISS_KEY = 'mohanndes_notif_prompt_dismissed';

/** One-time banner asking the user to enable official system notifications. */
export default function NotificationPermissionPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      return;
    }
    isNativePermissionGranted().then((granted) => {
      if (!cancelled && !granted) setVisible(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const granted = await requestNativePermission();
      if (granted) {
        setVisible(false);
      } else {
        setDenied(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLater = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div className="mx-4 mt-3 rounded-2xl border-2 border-teal-200 bg-teal-50 p-4 flex items-start gap-3 shadow-sm animate-fade-in dark:bg-teal-950/40 dark:border-teal-800">
      <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center flex-shrink-0">
        <BellRing className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">فعّل الإشعارات الرسمية 🔔</p>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
          ليصلك تنبيه فوري في شريط النظام عند إضافة محاضرة أو تكليف أو اختبار، وتذكير قبل كل محاضرة.
        </p>
        {denied && (
          <p className="text-xs text-red-600 mt-1">
            تم الرفض — يمكنك تفعيلها لاحقًا من إعدادات الهاتف ← التطبيقات ← المهندس ← الإشعارات.
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleEnable}
            disabled={busy}
            className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all disabled:opacity-60"
          >
            {busy ? 'جاري التفعيل...' : 'تفعيل الإشعارات'}
          </button>
          <button
            onClick={handleLater}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2 transition-colors"
          >
            لاحقًا
          </button>
        </div>
      </div>
      <button onClick={handleLater} className="p-1 rounded-lg text-slate-400 hover:bg-slate-200/60 transition-colors flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
