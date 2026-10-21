import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';

/**
 * شبكة أمان الواجهة: أي خطأ غير متوقع داخل شجرة React كان سابقاً يُسقِط
 * الشجرة بالكامل فيبقى المستخدم أمام شاشة بيضاء/متجمدة بلا أي رسالة.
 * هذا المكوّن يلتقط الخطأ ويعرض شاشة استرجاع بدل التجمد.
 *
 * لا يستورد أي شيء من طبقة البيانات (supabase/api) عن قصد: يجب أن يعمل
 * حتى لو كان سبب الانهيار داخل تلك الطبقة.
 */

type Props = { children: ReactNode };

type State = {
  error: Error | null;
  /** عدد مرات الانهيار المتتالية في نفس الجلسة (لمنع حلقة إعادة تحميل). */
  crashes: number;
};

const CRASH_KEY = 'mohanndes_ui_crashes';
const CRASH_WINDOW_MS = 60_000;

function readCrashes(): { count: number; at: number } {
  try {
    const raw = sessionStorage.getItem(CRASH_KEY);
    if (!raw) return { count: 0, at: 0 };
    const parsed = JSON.parse(raw) as { count?: unknown; at?: unknown };
    return {
      count: typeof parsed.count === 'number' ? parsed.count : 0,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
    };
  } catch {
    return { count: 0, at: 0 };
  }
}

function writeCrashes(count: number): void {
  try {
    sessionStorage.setItem(CRASH_KEY, JSON.stringify({ count, at: Date.now() }));
  } catch {
    // ignore
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, crashes: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const prev = readCrashes();
    const count = Date.now() - prev.at < CRASH_WINDOW_MS ? prev.count + 1 : 1;
    writeCrashes(count);
    this.setState({ crashes: count });
    // سجّل التفاصيل للتصحيح من كونسول الجهاز (chrome://inspect).
    console.error('[ui] crash caught by ErrorBoundary:', error, info.componentStack);
  }

  private handleReload = (): void => {
    try {
      writeCrashes(0);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  private handleResume = (): void => {
    // إخفاء شاشة الخطأ ومحاولة إعادة الرسم بدون إعادة تحميل الصفحة.
    this.setState({ error: null });
  };

  private handleLogout = (): void => {
    try {
      localStorage.removeItem('univ_user');
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render(): ReactNode {
    const { error, crashes } = this.state;
    if (!error) return this.props.children;

    const looping = crashes >= 3;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6" dir="rtl">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-amber-600" />
          </div>
          <h1 className="text-lg font-bold text-slate-800 mb-2">
            {looping ? 'تعذّر تشغيل التطبيق' : 'حدث خطأ غير متوقع'}
          </h1>
          <p className="text-sm text-slate-600 leading-6 mb-1">
            {looping
              ? 'تكرر الخطأ أكثر من مرة. أعد تحميل الصفحة، وإن استمر فامسح بيانات الموقع ثم سجّل الدخول من جديد.'
              : 'تم إيقاف الشاشة الحالية لحماية بياناتك بدل تجميد التطبيق.'}
          </p>
          <p className="text-[11px] text-slate-400 break-all mb-5 font-mono" dir="ltr">
            {String(error.message || error.name || 'Unknown error').slice(0, 180)}
          </p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2.5 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة تحميل التطبيق
            </button>
            {!looping && (
              <button
                type="button"
                onClick={this.handleResume}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold py-2.5 transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
                متابعة بدون إعادة تحميل
              </button>
            )}
            <button
              type="button"
              onClick={this.handleLogout}
              className="w-full rounded-xl text-slate-500 hover:text-rose-600 text-xs font-medium py-2 transition-colors"
            >
              تسجيل الخروج والعودة لشاشة الدخول
            </button>
          </div>
        </div>
      </div>
    );
  }
}
