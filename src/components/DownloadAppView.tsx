import { useState } from 'react';
import { Download, Apple, Bot, CheckCircle2 } from 'lucide-react';
import IosInstallGuide from '@/components/IosInstallGuide';
import { getIosAppUrl } from '@/lib/iosUrl';

type Platform = 'android' | 'ios';

export default function DownloadAppView() {
  const [platform, setPlatform] = useState<Platform>('ios');
  const iosUrl = getIosAppUrl();

  return (
    <div className="space-y-6 animate-fade-in-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-md">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">تحميل التطبيق</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">اختر نظام جهازك وثبت التطبيق بخطوات بسيطة</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800">
        <button onClick={() => setPlatform('android')} className={`flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${platform === 'android' ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow' : 'text-slate-500'}`}>
          <Bot className="w-4 h-4" /> اندرويد (APK)
        </button>
        <button onClick={() => setPlatform('ios')} className={`flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${platform === 'ios' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow' : 'text-slate-500'}`}>
          <Apple className="w-4 h-4" /> آيفون (iOS)
        </button>
      </div>
      {platform === 'android' ? (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <p className="font-bold text-slate-800 dark:text-slate-100">طريقة التثبيت على اندرويد:</p>
            <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <li>1 — اطلب ملف APK من بوت التيليجرام (زر تنزيل التطبيق ثم اندرويد).</li>
              <li>2 — افتح الملف واضغط تثبيت، ووافق على التثبيت من مصادر غير معروفة اذا طلب منك.</li>
              <li>3 — ستجد ايقونة المهندس على شاشتك الرئيسية.</li>
            </ol>
            <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">او يمكنك استخدام نسخة الويب من زر آيفون — تعمل على الاندرويد ايضا بدون تثبيت.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">رابطك الحالي: <span dir="ltr" className="font-mono text-xs">{iosUrl || 'سيظهر بعد النشر على Vercel'}</span></p>
          </div>
          <IosInstallGuide />
        </div>
      )}
    </div>
  );
}
