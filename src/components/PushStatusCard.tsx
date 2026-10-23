import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { getPushDeviceStatus, isPushCapable, repairPush, type PushDeviceStatus } from '@/lib/push';

/**
 * «حالة الإشعارات» — تشخيص مرئي بدل التخمين.
 *
 * السبب الأكثر شيوعاً لظهور الإشعارات «ميتة» لا يراه السيرفر أبداً: صلاحية
 * مرفوضة على مستوى النظام (أندرويد 13+) أو صف جهاز معطّل. في الحالتين يقبل
 * FCM الرسالة (HTTP 200) بينما لا يظهر شيء على الهاتف. هذه البطاقة تقرأ
 * الحقيقة من الطرفين (النظام + القاعدة) وتُصلحها بضغطة.
 */
type Props = {
  /** يُظهر سطر «جهاز مطوّر» (شاشة إعدادات المطوّر). */
  isDeveloper?: boolean;
};

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={
          ok
            ? 'font-bold text-green-600 dark:text-green-400'
            : 'font-bold text-amber-600 dark:text-amber-400'
        }
      >
        {value}
      </span>
    </div>
  );
}

export default function PushStatusCard({ isDeveloper = false }: Props) {
  const [status, setStatus] = useState<PushDeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isPushCapable()) return;
    setStatus(await getPushDeviceStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRepair = async () => {
    setBusy(true);
    try {
      setStatus(await repairPush());
    } finally {
      setBusy(false);
    }
  };

  // الويب/PWA يستخدم Web Push (مسار مختلف، له تنبيهه الخاص) — لا نعرض
  // بطاقة FCM هناك لأنها ستقول «غير مسجَّل» وهي في الحقيقة تعمل.
  if (!isPushCapable()) return null;

  const permissionOk = status?.permission === 'granted';
  const permissionLabel =
    status?.permission === 'granted'
      ? 'مسموح'
      : status?.permission === 'denied'
        ? 'ممنوع من النظام'
        : status?.permission === 'unsupported'
          ? 'غير مدعوم'
          : 'لم يُطلب بعد';

  const issues: string[] = [];
  if (status) {
    if (status.permission === 'denied') {
      issues.push(
        'الإشعارات ممنوعة من نظام الهاتف: الإعدادات ← التطبيقات ← المهندس ← الإشعارات ← السماح. بدونها لا يظهر أي إشعار مهما كان السيرفر سليماً.',
      );
    } else if (status.permission === 'prompt') {
      issues.push('لم تُمنح صلاحية الإشعارات بعد — اضغط «إصلاح الإشعارات» للموافقة.');
    }
    if (status.permission === 'granted' && !status.token) {
      issues.push('لم يُصدر النظام توكن إشعارات لهذا الجهاز بعد — اضغط «إصلاح الإشعارات».');
    }
    if (status.token && !status.serverReachable) {
      issues.push(
        'تعذّر التحقق من السيرفر (تحتاج هجرة 20261024090000 أو لا يوجد اتصال). الإشعارات قد تعمل، لكن الحالة غير مؤكَّدة.',
      );
    }
    if (status.serverReachable && status.token && !status.registered) {
      issues.push('هذا الجهاز غير مسجَّل في قاعدة الإشعارات — اضغط «إصلاح الإشعارات» ليسجّله الآن.');
    }
    if (status.registered && !status.alertsEnabled) {
      issues.push('تنبيهات المحتوى موقوفة لهذا الجهاز في قاعدة البيانات — «إصلاح الإشعارات» يعيد تفعيلها.');
    }
    if (isDeveloper && status.serverReachable && status.registered && !status.isDeveloperDevice) {
      issues.push(
        'هذا الجهاز ليس مُعلَّماً كمطوّر: إشعارات «تسجيل جديد» و«ملاحظة جديدة» لن تصل إليه. سجّل الدخول كمطوّر على هذا الهاتف (نسخة v34+) ثم اضغط إصلاح.',
      );
    }
  }

  const healthy = Boolean(status) && issues.length === 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-950/50 flex items-center justify-center">
          <BellRing className="w-4 h-4 text-teal-600 dark:text-teal-400" />
        </div>
        <h3 className="font-bold text-slate-800 dark:text-slate-100">حالة الإشعارات</h3>
        {healthy && <CheckCircle2 className="w-4 h-4 text-green-500 mr-auto" />}
      </div>

      {!status ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          جاري الفحص...
        </div>
      ) : (
        <div className="space-y-2">
          <StatusRow label="صلاحية النظام" value={permissionLabel} ok={permissionOk} />
          <StatusRow
            label="تسجيل الجهاز"
            value={!status.token ? 'لا يوجد توكن' : status.registered ? 'مسجَّل' : 'غير مسجَّل'}
            ok={Boolean(status.token) && status.registered}
          />
          <StatusRow
            label="تنبيهات المحتوى"
            value={status.alertsEnabled ? 'مفعّلة' : 'موقوفة'}
            ok={status.alertsEnabled}
          />
          {isDeveloper && (
            <StatusRow
              label="جهاز مطوّر"
              value={status.isDeveloperDevice ? 'نعم' : 'لا'}
              ok={status.isDeveloperDevice}
            />
          )}
        </div>
      )}

      {issues.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs rounded-lg px-4 py-3 space-y-1.5">
          {issues.map((issue) => (
            <p key={issue} className="flex items-start gap-2 leading-relaxed">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{issue}</span>
            </p>
          ))}
        </div>
      )}

      {healthy && (
        <p className="bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 text-xs rounded-lg px-4 py-3 leading-relaxed">
          كل شيء سليم على هذا الجهاز: ستصلك إشعارات المحاضرات والتكاليف والاختبارات حتى والتطبيق مغلق.
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleRepair}
          disabled={busy}
          className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          إصلاح الإشعارات
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-3 py-2 transition-colors disabled:opacity-60"
        >
          إعادة الفحص
        </button>
      </div>
    </div>
  );
}

