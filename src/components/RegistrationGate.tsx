import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, UserPlus, Loader2, Phone, User as UserIcon, CalendarDays, BookOpen, Bell, Cpu, Zap, KeyRound, Shield, Clock, RefreshCw, ArrowRight, Lock, Eye, EyeOff, HelpCircle, WifiOff } from 'lucide-react';
import { addRegistration, checkRegistration, verifyPassword, setUserPassword, verifyDeveloperCode, openProgressSession, describeRegistrationError, isLoginBlocked, type Registration } from '@/lib/api';
import { fetchSettings } from '@/lib/api';
import type { AppSettings } from '@/lib/supabase';
import { useToast } from '@/components/ToastProvider';
import type { Department } from '@/lib/supabase';

const APP_NAME = 'المهندس';

// Developer's WhatsApp number (same number used in App.tsx / AboutDeveloperView).
const DEV_PHONE = '779809243';

const DEPARTMENTS: { id: Department; label: string; icon: typeof Cpu; color: string }[] = [
  { id: 'ميكاترونكس', label: 'هندسة الميكاترونكس', icon: Cpu, color: 'from-cyan-500 to-blue-600' },
  { id: 'كهربائية', label: 'هندسة كهرباء', icon: Zap, color: 'from-amber-500 to-orange-600' },
];

/** رسالة موحّدة لرقم غير صالح — تُستخدم في كل شاشات البوابة. */
const PHONE_ERROR = 'رقم الهاتف يجب أن يكون يمنياً ويتكون من 9 أرقام تبدأ بـ 7 (مثال: 77xxxxxxx)';

/**
 * توحيد الرقم إلى الصيغة المخزّنة في القاعدة: 9 أرقام تبدأ بـ 7.
 *
 * المسجّل الجديد قد يكتب رقمه بصيغة دولية (+967…) أو يبدأه بصفر (077…)، أو
 * يفصل بين أجزائه بمسافات/شرطات، أو — وهو الأكثر شيوعاً على لوحات المفاتيح
 * العربية — يكتبه بأرقام عربية (٧٧٩…). كل هذه الصيغ كانت تفشل في التحقق
 * فتُظهر «رقم الهاتف يجب أن يكون يمنياً» لرقم يمني صحيح، فيتوقف الطالب عند
 * أول خطوة في الشاشة. هنا نُعيده دائماً إلى 9 أرقام.
 */
function normalizePhone(raw: string): string {
  const ascii = raw
    // أرقام عربية-هندية ٠١٢٣٤٥٦٧٨٩ وفارسية ۰۱۲۳۴۵۶۷۸۹ → ASCII
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  let digits = ascii.replace(/\D/g, '');
  // مقدمة الدولة: 00967 أو 967
  if (digits.startsWith('00967')) digits = digits.slice(5);
  else if (digits.startsWith('967') && digits.length > 9) digits = digits.slice(3);
  // صفر بادئ (077…)
  if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
  return digits;
}

/** هل الرقم (بعد التوحيد) صالح كرقم يمني؟ */
function isValidPhone(digits: string): boolean {
  return /^7\d{8}$/.test(digits);
}

type GateState = 'login' | 'register' | 'pending' | 'setPassword';

export default function RegistrationGate({ onRegistered }: { onRegistered: (r: Registration) => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState<Department | ''>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [showDevField, setShowDevField] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateState, setGateState] = useState<GateState>('login');
  const [pendingName, setPendingName] = useState('');
  const [activeUser, setActiveUser] = useState<Registration | null>(null);
  // Live connectivity flag for the gate screen (the app-wide OfflineBanner only
  // renders after login, so the gate needs its own signal).
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Display-only settings (academic level + semester) for the header badge.
  // Security: fetchSettings never returns dev_password — the developer code
  // is verified server-side through the verify_developer_code RPC.
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        /* display-only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the gate's connectivity flag in sync with the browser/WebView.
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /**
   * Warn the user (in red) that there is no internet connection.
   * Shows the semi-transparent red toast AND an inline message so the warning
   * stays visible until the toast auto-dismisses.
   */
  const notifyOffline = useCallback(() => {
    const message = 'أنت غير متصل بالإنترنت — تأكد من اتصالك ثم حاول مرة أخرى.';
    showToast('لا يوجد اتصال بالإنترنت', message, 'error', WifiOff);
    setError(message);
  }, [showToast]);

  /** True when the device has no usable connection. */
  const isOffline = (): boolean =>
    typeof navigator !== 'undefined' && navigator.onLine === false;

  // "Forgot password?" → open WhatsApp with the developer, pre-filled with a
  // ready-made reset-request message (incl. the phone they typed, if any), so
  // the user only has to hit Send inside WhatsApp.
  const handleForgotPassword = async () => {
    const phoneDigits = normalizePhone(phone);
    const message =
      'السلام عليكم، نسيت كلمة المرور في تطبيق "المهندس"' +
      (phoneDigits.length > 0 ? `، ورقم هاتفي: ${phoneDigits}` : '') +
      '، أرجو إعادة تعيينها. شكراً لكم.';

    const url = `https://wa.me/${DEV_PHONE}?text=${encodeURIComponent(message)}`;

    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } catch {
      window.open(url, '_blank');
    }
  };

  // Step 1: Phone + password login. Approved + correct password → enter.
  // No password yet / reset by developer → force create password. Pending → pending.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    // منع الإرسال المزدوج (نقرة/Enter متكررة) — كل نداء يفتح جلسة تقدّم
    // ويكتب على الخادم، والتكرار كان أحد أسباب الصفوف/المحاولات المكرّرة.
    if (loading) return;

    const phoneDigits = normalizePhone(phone);
    if (!isValidPhone(phoneDigits)) {
      setError(PHONE_ERROR);
      return;
    }

    // لا شيء في هذه الشاشة يعمل بدون شبكة (فحص الرقم + التحقق من كلمة المرور)،
    // لذا نُظهر التحذير الأحمر فوراً — قبل التحقق من رمز المطور، وإلا ظهر
    // «رمز المطور غير صحيح» بسبب فشل الشبكة لا بسبب خطأ في الرمز.
    if (isOffline()) {
      notifyOffline();
      return;
    }

    // Security: developer code is verified server-side (verify_developer_code
    // RPC). dev_password is never shipped to the browser anymore.
    let isDev = false;
    if (devCode.trim()) {
      setLoading(true);
      setError(null);
      try {
        isDev = await verifyDeveloperCode(devCode);
      } catch {
        isDev = false;
      } finally {
        setLoading(false);
      }
      if (!isDev) {
        setError('رمز المطور غير صحيح');
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const existing = await checkRegistration(phoneDigits);
      if (!existing) {
        setError('لا يوجد حساب بهذا الرقم. سجّل حساباً جديداً أولاً.');
        return;
      }
      if (!existing.is_approved) {
        setPendingName(existing.name);
        setGateState('pending');
        return;
      }

      // If the password columns don't exist yet (migration not applied),
      // password_hash is undefined. In that case the app runs in legacy
      // phone-only mode: let the user straight in.
      const passwordFeatureEnabled = existing.password_hash !== undefined;
      if (!passwordFeatureEnabled) {
        localStorage.setItem('univ_user', JSON.stringify(existing));
        onRegistered(existing);
        return;
      }

      // لا كلمة مرور بعد (حساب قديم اعتُمد، أو أعاد المطوّر تعيينها) ⇒ شاشة
      // «أنشئ كلمة مرور» مباشرة. كان هذا الفحص بعد طلب كلمة المرور، فيُطالب
      // الطالب الجديد بكتابة كلمة لا يملكها قبل أن تُعرض له شاشة إنشائها.
      if (!existing.password_hash || existing.must_change_password) {
        setActiveUser(existing);
        setGateState('setPassword');
        return;
      }

      // Password feature is active — a password is now required.
      if (!password) {
        setError('الرجاء إدخال كلمة المرور');
        return;
      }

      const ok = await verifyPassword(phoneDigits, password, existing.password_hash);
      if (!ok) {
        // انقطاع الشبكة داخل verify_password يُعيد false أيضاً (fail-closed)،
        // فلا نُلصق بالطالب «كلمة المرور غير صحيحة» بسبب الشبكة.
        if (isOffline()) {
          notifyOffline();
          return;
        }
        // فرق حاسم: verify_password تعيد false أيضاً عند تجاوز حدّ المحاولات
        // (10 محاولات/10 دقائق). بلا هذا الفحص كان الطالب يقرأ «كلمة المرور
        // غير صحيحة» وهو يُدخل الصحيحة، فيظن أن حسابه الجديد معطوب.
        const blocked = await isLoginBlocked(phoneDigits);
        setError(
          blocked.blocked
            ? `تم إيقاف محاولات الدخول مؤقتاً بعد 10 محاولات خاطئة. انتظر ${blocked.retryAfterMinutes} دقيقة ثم حاول مجدداً، أو اطلب من المطوّر إعادة تعيين كلمة المرور.`
            : 'كلمة المرور غير صحيحة',
        );
        return;
      }

      // Mint this student's server-side progress key while the password is in
      // hand (Section 11 isolation) — non-fatal: login proceeds either way.
      await openProgressSession(phoneDigits, password);

      localStorage.setItem('univ_user', JSON.stringify(existing));
      onRegistered(existing);
    } catch {
      setError(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'لا يوجد اتصال بالإنترنت — تأكد من اتصالك ثم حاول مرة أخرى.'
          : 'تعذّر التحقق. تأكد من اتصال الإنترنت وحاول مرة أخرى.',
      );
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Full registration with name + department (first time only)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    // منع الإرسال المزدوج: نقرة ثانية أثناء الكتابة على الخادم كانت تُنشئ
    // طلباً/صفّاً إضافياً لنفس الرقم (مصدر تكرار الحسابات في لوحة المطوّر).
    if (loading) return;

    // التسجيل يحتاج اتصالاً حقيقياً بالخادم (الإدارة تعتمد الطلب من هناك)،
    // فنُظهر التحذير الأحمر قبل أي نداء شبكي — بما فيه التحقق من رمز المطور.
    if (isOffline()) {
      notifyOffline();
      return;
    }

    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 4) {
      setError('الرجاء إدخال الاسم الرباعي (الاسم + الأب + الجد + العائلة)');
      return;
    }

    const phoneDigits = normalizePhone(phone);
    if (!isValidPhone(phoneDigits)) {
      setError(PHONE_ERROR);
      return;
    }

    if (!department) {
      setError('الرجاء اختيار التخصص');
      return;
    }

    if (password.length < 4) {
      setError('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين');
      return;
    }

    // Security: developer code is verified server-side (verify_developer_code
    // RPC). Never compare dev_password in the browser.
    let isDev = false;
    if (devCode.trim()) {
      setLoading(true);
      setError(null);
      try {
        isDev = await verifyDeveloperCode(devCode);
      } catch {
        isDev = false;
      } finally {
        setLoading(false);
      }
      if (!isDev) {
        setError('رمز المطور غير صحيح');
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const reg = await addRegistration(name.trim(), phoneDigits, department, password);
      // Password was stored above → mint the progress key too (non-fatal).
      await openProgressSession(phoneDigits, password);
      // `reg.is_approved` = طالب عائد كان حسابه معتمداً لكن بلا كلمة مرور:
      // بعد كتابتها الآن نُدخله مباشرة بدل حجزه على شاشة «بانتظار الموافقة».
      if (isDev || reg.is_approved) {
        localStorage.setItem('univ_user', JSON.stringify(reg));
        onRegistered(reg);
      } else {
        setPendingName(name.trim());
        setGateState('pending');
      }
    } catch (err) {
      // navigator.onLine قد يقول "متصل" رغم انقطاع الشبكة فعلياً (شبكة وهمية/كابتيف
      // Portal)، لذا نعتبر فشل الطلب الشبكي تعذّر اتصال ونُظهر الإشعار الأحمر.
      const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? '');
      if (isOffline() || /fetch|network|failed to fetch|timeout|abort/i.test(msg)) {
        notifyOffline();
      } else {
        // رسالة محدّدة بدل النص العام: نسخة قديمة (42501) أو رقم مسجّل مسبقاً.
        setError(describeRegistrationError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Create a new password (first login after approval / after a
  // developer reset). Sets the password, clears the must_change_password flag,
  // then enters the app.
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser) return;
    // منع الإرسال المزدوج أثناء كتابة كلمة المرور على الخادم.
    if (loading) return;

    if (password.length < 4) {
      setError('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين');
      return;
    }

    if (isOffline()) {
      notifyOffline();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await setUserPassword(activeUser.id, activeUser.phone, password);
      // Password now exists server-side → mint the progress key too (non-fatal).
      await openProgressSession(activeUser.phone, password);
      const updated: Registration = { ...activeUser, password_hash: 'set', must_change_password: false };
      localStorage.setItem('univ_user', JSON.stringify(updated));
      onRegistered(updated);
    } catch {
      setError(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'لا يوجد اتصال بالإنترنت — تأكد من اتصالك ثم حاول مرة أخرى.'
          : 'تعذّر التحقق. تأكد من اتصال الإنترنت وحاول مرة أخرى.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    if (loading) return;
    const phoneDigits = normalizePhone(phone);
    if (!isValidPhone(phoneDigits)) {
      setError(PHONE_ERROR);
      return;
    }
    if (isOffline()) {
      notifyOffline();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const reg = await checkRegistration(phoneDigits);
      if (!reg) {
        setError('لم يتم العثور على تسجيل بهذا الرقم. سجّل أولاً.');
      } else if (reg.is_approved) {
        // Approved: send back to the login screen so the user enters their
        // password (or creates one if they never had it).
        // ملاحظة للمستخدم: بدون هذا الإشعار يبدو الانتقال إلى شاشة الدخول كأنه
        // لم يفعل شيئاً؛ الإشعار يقول صراحةً إن الحساب اعتُمد وأن المطلوب الآن
        // كتابة كلمة المرور.
        setPassword('');
        setConfirmPassword('');
        setGateState('login');
        showToast('تم اعتماد حسابك', 'أدخل رقم هاتفك وكلمة المرور للدخول.', 'success');
      } else {
        setPendingName(reg.name);
        setGateState('pending');
      }
    } catch {
      setError(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'لا يوجد اتصال بالإنترنت — تأكد من اتصالك ثم حاول مرة أخرى.'
          : 'تعذّر التحقق. تأكد من اتصال الإنترنت وحاول مرة أخرى.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (gateState === 'pending') {
    return (
      <div className="min-h-screen p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))] px-[calc(1rem+env(safe-area-inset-left,0px))] bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 flex items-center justify-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative w-full max-w-md text-center">
          <div className="mb-8 animate-fade-in-up">
            <div className="w-20 h-20 rounded-2xl bg-amber-500/20 flex items-center justify-center shadow-2xl mx-auto mb-4">
              <Clock className="w-11 h-11 text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">بانتظار الموافقة</h1>
            <p className="text-slate-400">
              {pendingName}، تم استلام طلبك بنجاح. سيتمكن المطور من مراجعة طلبك والموافقة عليه.
            </p>
          </div>

          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl p-6 shadow-2xl animate-scale-in space-y-4">
            <div className="flex items-center gap-3 bg-amber-50 rounded-xl p-4 text-right">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-slate-800 dark:text-slate-100">حالة طلبك: قيد المراجعة</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  عند موافقة المطور ستتمكن من الدخول برقم هاتفك وكلمة المرور التي أنشأتها عند التسجيل.
                </p>
              </div>
            </div>

            <div className="text-right space-y-2">
                <label htmlFor="pending-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">رقم الهاتف المسجّل (إلزامي)</label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  id="pending-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={16}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="رقم هاتفك"
                  className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                  dir="ltr"
                />
              </div>
              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in"
                >
                  {error}
                </div>
              )}
              <button
                onClick={handleCheckStatus}
                disabled={loading || !phone.trim()}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-md"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                تحقق من الحالة
              </button>
            </div>

            <button
              onClick={() => {
                setGateState('login');
                setError(null);
              }}
              className="w-full text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white text-sm font-medium transition-colors"
            >
              العودة
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Set-password screen (first login / after developer reset) ----------
  if (gateState === 'setPassword' && activeUser) {
    return (
      <div className="min-h-screen p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))] px-[calc(1rem+env(safe-area-inset-left,0px))] bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 flex items-center justify-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          <div className="text-center mb-8 animate-fade-in-up">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center shadow-2xl mx-auto mb-4">
              <Lock className="w-11 h-11 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">أنشئ كلمة مرور</h1>
            <p className="text-slate-400">
              مرحباً {activeUser.name}، أنشئ كلمة مرور خاصة بك لحماية حسابك.
            </p>
          </div>

          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl animate-scale-in">
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div>
                <label htmlFor="set-password" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">كلمة المرور الجديدة</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    id="set-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="4 أحرف على الأقل"
                    className="w-full pr-11 pl-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  ستدخل بها في المرات القادمة، لذا احفظها في مكان آمن.
                </p>
              </div>

              <div>
                <label htmlFor="set-password-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">تأكيد كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    id="set-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg hover:shadow-xl"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Lock className="w-5 h-5" />
                    حفظ والدخول
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }


  const isRegistering = gateState === 'register';

  return (
    <div className="min-h-screen p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))] px-[calc(1rem+env(safe-area-inset-left,0px))] bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 flex items-center justify-center">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-10 right-10 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center shadow-2xl mx-auto mb-4">
            <GraduationCap className="w-11 h-11 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{APP_NAME}</h1>
          <p className="text-slate-400">نظّم محاضراتك وتكاليفك ومذاكرتك في مكان واحد</p>
          {settings && (
            <div className="inline-flex items-center gap-2 mt-3 bg-white/10 rounded-full px-4 py-1.5 text-xs text-slate-300">
              <CalendarDays className="w-3.5 h-3.5" />
              {settings.academic_level} — {settings.semester}
            </div>
          )}
        </div>

        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl animate-scale-in">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center shadow-md">
              {isRegistering ? <UserPlus className="w-5 h-5 text-white" /> : <Phone className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {isRegistering ? 'تسجيل جديد' : 'تسجيل الدخول'}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {isRegistering ? 'أكمل بياناتك للتسجيل' : 'أدخل رقم هاتفك للدخول'}
              </p>
            </div>
          </div>

          {/* تحذير دائم باللون الأحمر الشفاف أثناء انقطاع الإنترنت */}
          {!isOnline && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-5 flex items-start gap-3 bg-gradient-to-br from-rose-500/85 to-red-600/85 backdrop-blur-md border-2 border-rose-200/50 rounded-2xl p-3.5 text-white shadow-lg animate-fade-in"
            >
              <div className="w-9 h-9 rounded-xl bg-white/25 flex items-center justify-center flex-shrink-0">
                <WifiOff className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm">لا يوجد اتصال بالإنترنت</p>
                <p className="text-sm text-white/90 mt-0.5 leading-relaxed">
                  أنت غير متصل بالإنترنت — تأكد من اتصالك بالنت ثم حاول مرة أخرى.
                </p>
              </div>
            </div>
          )}

          {!isRegistering ? (
            /* Step 1: Phone-only login */
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">رقم الهاتف (إلزامي)</label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-300" />
                  <input
                    id="login-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={16}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="7XXXXXXXX"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  9 أرقام تبدأ بـ 7 — يمكنك لصقه بصيغته الدولية (+967 أو 00967)
                </p>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-300" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="كلمة المرور التي أنشأتها عند التسجيل"
                    className="w-full pr-11 pl-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  إن كان حسابك بلا كلمة مرور بعد، اتركها فارغة واضغط متابعة لإنشائها
                </p>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowDevField(!showDevField)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white transition-colors"
                >
                  <Shield className="w-3.5 h-3.5" />
                  دخول المطور
                </button>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors text-left max-w-[60%] group"
                  title="اضغط لإرسال رسالة واتساب للمطور"
                >
                  <HelpCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    نسيت كلمة المرور؟{' '}
                    <span className="text-emerald-600 font-medium group-hover:underline">
                      تواصل مع المطور لإعادة تعيينها
                    </span>
                  </span>
                </button>
              </div>
              {showDevField && (
                <div className="relative animate-fade-in">
                  <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="password"
                    value={devCode}
                    onChange={(e) => setDevCode(e.target.value)}
                    placeholder="رمز المطور السري"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-amber-200 bg-amber-50/50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                  <p className="text-xs text-amber-600/70 mt-1">اتركه فارغاً إذا كنت مستخدم عادي</p>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg hover:shadow-xl"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ArrowRight className="w-5 h-5" />
                    متابعة
                  </>
                )}
              </button>

              <p className="text-center text-sm text-slate-600 dark:text-slate-300">
                ليس لديك حساب؟{' '}
                <button
                  type="button"
                  onClick={() => {
                    setGateState('register');
                    setError(null);
                  }}
                  className="text-teal-600 hover:text-teal-700 font-medium transition-colors"
                >
                  سجّل الآن
                </button>
              </p>
            </form>
          ) : (
            /* Step 2: Full registration (first time only) */
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">الاسم الرباعي (إلزامي)</label>
                <div className="relative">
                  <UserIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    id="reg-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: محمد أحمد علي الحيدري"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">يجب إدخال الاسم الكامل (4 أجزاء)</p>
              </div>

              <div>
                <label htmlFor="reg-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">رقم الهاتف اليمني (إلزامي)</label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    id="reg-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={16}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="7XXXXXXXX"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  9 أرقام تبدأ بـ 7 (شبكات اليمن) — الصيغة الدولية (+967) مقبولة أيضاً
                </p>
              </div>

              <div>
                <label htmlFor="reg-password" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-300" />
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="4 أحرف على الأقل"
                    className="w-full pr-11 pl-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reg-password-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">تأكيد كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-300" />
                  <input
                    id="reg-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">التخصص (إلزامي)</label>
                <div className="grid grid-cols-1 gap-2.5">
                  {DEPARTMENTS.map((dept) => {
                    const Icon = dept.icon;
                    const isSelected = department === dept.id;
                    return (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => setDepartment(dept.id)}
                        className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-teal-500 bg-teal-50 shadow-md'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${dept.color} flex items-center justify-center flex-shrink-0`}>
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        <span className={`font-medium ${isSelected ? 'text-teal-700 dark:text-teal-300' : 'text-slate-700 dark:text-slate-200'}`}>
                          {dept.label}
                        </span>
                        <div className={`mr-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          isSelected ? 'border-teal-500 bg-teal-500' : 'border-slate-300'
                        }`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowDevField(!showDevField)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white transition-colors"
                >
                  <Shield className="w-3.5 h-3.5" />
                  دخول المطور
                </button>
                {showDevField && (
                  <div className="mt-2 relative animate-fade-in">
                    <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="password"
                      value={devCode}
                      onChange={(e) => setDevCode(e.target.value)}
                      placeholder="رمز المطور السري"
                      className="w-full pr-11 pl-4 py-3 rounded-xl border border-amber-200 bg-amber-50/50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                      dir="ltr"
                    />
                    <p className="text-xs text-amber-600/70 mt-1">اتركه فارغاً إذا كنت مستخدم عادي</p>
                  </div>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg hover:shadow-xl"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="w-5 h-5" />
                    تسجيل وانتظار الموافقة
                  </>
                )}
              </button>

              <p className="text-center text-sm text-slate-600 dark:text-slate-300">
                لديك حساب بالفعل؟{' '}
                <button
                  type="button"
                  onClick={() => {
                    setGateState('login');
                    setError(null);
                  }}
                  className="text-teal-600 hover:text-teal-700 font-medium transition-colors"
                >
                  تسجيل الدخول
                </button>
              </p>
            </form>
          )}
        </div>

        <div className="flex items-center justify-center gap-6 mt-6 text-slate-300 text-sm">
          <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> الجدول</span>
          <span className="flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> المذاكرة</span>
          <span className="flex items-center gap-1.5"><Bell className="w-4 h-4" /> الإشعارات</span>
        </div>
      </div>
    </div>
  );
}
