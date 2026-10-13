import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, UserPlus, Loader2, Phone, User as UserIcon, CalendarDays, BookOpen, Bell, Cpu, Zap, KeyRound, Shield, Clock, RefreshCw, ArrowRight, Lock, Eye, EyeOff, HelpCircle, WifiOff } from 'lucide-react';
import { addRegistration, checkRegistration, verifyPassword, setUserPassword, type Registration } from '@/lib/api';
import { fetchSettings } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import type { Department, AppSettings } from '@/lib/supabase';

const APP_NAME = 'المهندس';

// Developer's WhatsApp number (same number used in App.tsx / AboutDeveloperView).
const DEV_PHONE = '779809243';

const DEPARTMENTS: { id: Department; label: string; icon: typeof Cpu; color: string }[] = [
  { id: 'ميكاترونكس', label: 'هندسة الميكاترونكس', icon: Cpu, color: 'from-cyan-500 to-blue-600' },
  { id: 'كهربائية', label: 'هندسة كهرباء', icon: Zap, color: 'from-amber-500 to-orange-600' },
];

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
  const [settings, setSettings] = useState<AppSettings | null>(null);
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

  useEffect(() => {
    fetchSettings().then(setSettings).catch(() => {});
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
    const phoneDigits = phone.replace(/\D/g, '');
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

    const phoneDigits = phone.replace(/\D/g, '');
    if (!phoneDigits.startsWith('7') || phoneDigits.length !== 9) {
      setError('رقم الهاتف يجب أن يكون يمنياً ويتكون من 9 أرقام تبدأ بـ 7 (مثل: 779809243)');
      return;
    }

    let isDev = false;
    if (devCode.trim() && settings) {
      if (devCode.trim() === settings.dev_password) {
        isDev = true;
      } else {
        setError('رمز المطور غير صحيح');
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      if (isOffline()) {
        notifyOffline();
        return;
      }
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
        if (isDev) localStorage.setItem('is_dev', 'true');
        onRegistered(existing);
        return;
      }

      // Password feature is active — a password is now required.
      if (!password) {
        setError('الرجاء إدخال كلمة المرور');
        return;
      }

      // No password yet, or the developer reset it → force creating one now.
      if (!existing.password_hash || existing.must_change_password) {
        setActiveUser(existing);
        setGateState('setPassword');
        return;
      }

      const ok = await verifyPassword(phoneDigits, password, existing.password_hash);
      if (!ok) {
        setError('كلمة المرور غير صحيحة');
        return;
      }

      localStorage.setItem('univ_user', JSON.stringify(existing));
      if (isDev) localStorage.setItem('is_dev', 'true');
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

    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 4) {
      setError('الرجاء إدخال الاسم الرباعي (الاسم + الأب + الجد + العائلة)');
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (!phoneDigits.startsWith('7') || phoneDigits.length !== 9) {
      setError('رقم الهاتف يجب أن يكون يمنياً ويتكون من 9 أرقام تبدأ بـ 7 (مثل: 779809243)');
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

    let isDev = false;
    if (devCode.trim() && settings) {
      if (devCode.trim() === settings.dev_password) {
        isDev = true;
      } else {
        setError('رمز المطور غير صحيح');
        return;
      }
    }

    // لا يمكن إتمام التسجيل بدون إنترنت (الطلب يحتاج مراجعة الإدارة على السيرفر)،
    // لذا نُنبه المسجل الجديد فوراً بإشعار أحمر شفاف بدل محاولة فاشلة.
    if (isOffline()) {
      notifyOffline();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const reg = await addRegistration(name.trim(), phoneDigits, department, password);
      if (isDev) {
        localStorage.setItem('is_dev', 'true');
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
        setError('حدث خطأ أثناء التسجيل. حاول مرة أخرى.');
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

    if (password.length < 4) {
      setError('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isOffline()) {
        notifyOffline();
        return;
      }
      await setUserPassword(activeUser.id, activeUser.phone, password);
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
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phoneDigits) return;
    setLoading(true);
    setError(null);
    try {
      if (isOffline()) {
        notifyOffline();
        return;
      }
      const reg = await checkRegistration(phoneDigits);
      if (!reg) {
        setError('لم يتم العثور على تسجيل بهذا الرقم. سجّل أولاً.');
      } else if (reg.is_approved) {
        // Approved: send back to the login screen so the user enters their
        // password (or creates one if they never had it).
        setPassword('');
        setConfirmPassword('');
        setGateState('login');
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

          <div className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 shadow-2xl animate-scale-in space-y-4">
            <div className="flex items-center gap-3 bg-amber-50 rounded-xl p-4 text-right">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-slate-800">حالة طلبك: قيد المراجعة</p>
                <p className="text-sm text-slate-500">عند موافقة المطور، يمكنك الدخول باستخدام رقم هاتفك.</p>
              </div>
            </div>

            <div className="text-right space-y-2">
              <label className="block text-sm font-medium text-slate-700">تحقق من حالة الموافقة</label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="رقم هاتفك"
                  className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                  dir="ltr"
                />
              </div>
              {error && (
                <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in">
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
              className="w-full text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors"
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

          <div className="bg-white/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl animate-scale-in">
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور الجديدة</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="4 أحرف على الأقل"
                    className="w-full pr-11 pl-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">تأكيد كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in">
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

        <div className="bg-white/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl animate-scale-in">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center shadow-md">
              {isRegistering ? <UserPlus className="w-5 h-5 text-white" /> : <Phone className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                {isRegistering ? 'تسجيل جديد' : 'تسجيل الدخول'}
              </h2>
              <p className="text-sm text-slate-500">
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
                <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الهاتف اليمني (إلزامي)</label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="7XXXXXXXX"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">9 أرقام تبدأ بـ 7 (شبكات اليمن)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="كلمة المرور"
                    className="w-full pr-11 pl-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowDevField(!showDevField)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Shield className="w-3.5 h-3.5" />
                  دخول المطور
                </button>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="flex items-start gap-1.5 text-xs text-slate-400 hover:text-emerald-600 transition-colors text-left max-w-[60%] group"
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
                <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in">
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

              <p className="text-center text-sm text-slate-400">
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
                <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم الرباعي (إلزامي)</label>
                <div className="relative">
                  <UserIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder=""
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">يجب إدخال الاسم الكامل (4 أجزاء)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الهاتف اليمني (إلزامي)</label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="7XXXXXXXX"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">9 أرقام تبدأ بـ 7 (شبكات اليمن)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="4 أحرف على الأقل"
                    className="w-full pr-11 pl-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">تأكيد كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
                    dir="ltr"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">التخصص (إلزامي)</label>
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
                        <span className={`font-medium ${isSelected ? 'text-teal-700' : 'text-slate-700'}`}>
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
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
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
                <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in">
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

              <p className="text-center text-sm text-slate-400">
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

        <div className="flex items-center justify-center gap-6 mt-6 text-slate-400 text-sm">
          <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> الجدول</span>
          <span className="flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> المذاكرة</span>
          <span className="flex items-center gap-1.5"><Bell className="w-4 h-4" /> الإشعارات</span>
        </div>
      </div>
    </div>
  );
}
