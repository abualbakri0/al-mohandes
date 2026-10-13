import { useState } from 'react';
import { Share, PlusSquare, Check, Copy, ExternalLink, Smartphone, Globe } from 'lucide-react';
import { getIosAppUrl, isIOSDevice } from '@/lib/iosUrl';

export default function IosInstallGuide() {
  const iosUrl = getIosAppUrl();
  const isIOS = isIOSDevice();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!iosUrl) return;
    try { await navigator.clipboard.writeText(iosUrl); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = iosUrl;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!iosUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: 'تطبيق المهندس', url: iosUrl });
      else window.open(iosUrl, '_blank', 'noopener,noreferrer');
    } catch { /* cancelled */ }
  };

  const steps = [
    { icon: Globe, title: 'افتح الرابط في سفاري', desc: 'انسخ الرابط بالاسفل او اضغط زر الفتح، وتاكد انك تفتحه من Safari وليس من داخل تيليجرام.' },
    { icon: Share, title: 'اضغط زر المشاركة', desc: 'من شريط سفاري السفلي اضغط زر المشاركة (مربع بسهم للاعلى).' },
    { icon: PlusSquare, title: 'اختر اضافة الى الشاشة الرئيسية', desc: 'مرر للاسفل واضغط Add to Home Screen ثم اضغط اضافة بالاعلى.' },
    { icon: Smartphone, title: 'افتحه كتطبيق حقيقي', desc: 'ستجد ايقونة المهندس بجانب تطبيقاتك وتعمل بملء الشاشة.' },
  ];

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm leading-relaxed text-amber-800 dark:text-amber-200">
        اجهزة <b>الآيفون لا تدعم ملفات APK</b> (خاصة بالاندرويد فقط). لذلك نوفر لك نسخة الويب — ثبتها بالخطوات بالاسفل وستعمل كتطبيق حقيقي.
      </div>
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">رابط نسخة الآيفون:</p>
        {iosUrl ? (
          <>
            <p dir="ltr" className="text-xs font-mono bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 break-all text-teal-700 dark:text-teal-300 border border-slate-100 dark:border-slate-700">{iosUrl}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <a href={iosUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold shadow active:scale-[0.98] transition-all">
                <ExternalLink className="w-4 h-4" /> فتح الرابط في سفاري
              </a>
              <button onClick={copyLink} className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm text-slate-700 dark:text-slate-200 active:scale-[0.98] transition-all">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />} {copied ? 'تم النسخ!' : 'نسخ'}
              </button>
              <button onClick={shareLink} className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-teal-600 text-white font-bold text-sm shadow active:scale-[0.98] transition-all">
                <Share className="w-4 h-4" /> مشاركة
              </button>
            </div>
            {!isIOS && <p className="text-xs text-slate-500 leading-relaxed">انت تتصفح من غير آيفون — انسخ الرابط وارسله لنفسك على الآيفون ثم افتحه من سفاري هناك.</p>}
          </>
        ) : <p className="text-sm text-slate-500">الرابط غير متاح حاليا.</p>}
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="w-7 h-7 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center shrink-0"><Icon className="w-5 h-5 text-teal-600 dark:text-teal-400" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-800 dark:text-slate-100">{s.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">{s.desc}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
