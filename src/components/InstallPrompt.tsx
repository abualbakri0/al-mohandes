import { useEffect, useState } from 'react';
import { Download, Share, X, PlusSquare, Apple } from 'lucide-react';

/**
 * Smart install banner:
 * - Android/Chrome/Edge: uses beforeinstallprompt → one-tap install.
 * - iPhone (Safari): shows "Share → Add to Home Screen" steps (Arabic).
 * - Already installed (standalone) or native app: renders nothing.
 */

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isNativeApp(): boolean {
  try {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    const nav = navigator as Navigator & { standalone?: boolean };
    if (typeof nav.standalone === 'boolean' && nav.standalone) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

const DISMISS_KEY = 'mohanndes_install_dismissed_v1';

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (isNativeApp() || isStandalone()) return;
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', onBIP);
    // iPhone: no beforeinstallprompt — show manual steps (unless dismissed).
    if (isIOS() && !isStandalone()) setShowIOS(true);
    return () => window.removeEventListener('beforeinstallprompt', onBIP);
  }, []);

  if (isNativeApp() || isStandalone() || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  const handleInstall = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferred(null);
        dismiss();
      }
    } catch {
      /* ignore */
    }
  };

  // Android / desktop browsers with install support
  if (deferred) {
    return (
      <div className="mx-4 mt-3 flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-l from-teal-600 to-cyan-600 text-white shadow-lg animate-fade-in-up">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm">ثبّت تطبيق المهندس</p>
          <p className="text-xs text-teal-100">وصول سريع من الشاشة الرئيسية + يعمل دون إنترنت</p>
        </div>
        <button onClick={handleInstall} className="px-4 py-2 rounded-xl bg-white text-teal-700 text-sm font-bold shadow hover:bg-teal-50 active:scale-95 transition-all shrink-0">
          تثبيت
        </button>
        <button onClick={dismiss} aria-label="إغلاق" className="p-1.5 rounded-lg hover:bg-white/20 transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // iPhone Safari — manual "Add to Home Screen" guide
  if (showIOS) {
    return (
      <div className="mx-4 mt-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg animate-fade-in-up">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shrink-0">
            <Apple className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-slate-800 dark:text-slate-100">لمستخدمي الآيفون: ثبّت التطبيق</p>
            <ol className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <li className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
                اضغط زر <Share className="w-3.5 h-3.5 inline text-teal-600" /> <b>مشاركة</b> أسفل متصفح سفاري
              </li>
              <li className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 text-[11px] font-bold flex items-center justify-center shrink-0">2</span>
                اختر <PlusSquare className="w-3.5 h-3.5 inline text-teal-600" /> <b>إضافة إلى الشاشة الرئيسية</b>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 text-[11px] font-bold flex items-center justify-center shrink-0">3</span>
                اضغط <b>إضافة</b> — ستجد أيقونة المهندس بجانب تطبيقاتك
              </li>
            </ol>
          </div>
          <button onClick={dismiss} aria-label="إغلاق" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
