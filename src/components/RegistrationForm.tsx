import { useState } from 'react';
import { UserPlus, Loader2, CheckCircle2, Phone, User as UserIcon, WifiOff } from 'lucide-react';
import { addRegistration, type Registration } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

export default function RegistrationForm({ onRegistered }: { onRegistered: (r: Registration) => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError('الرجاء إدخال الاسم ورقم الهاتف');
      return;
    }

    // التسجيل يحتاج اتصالاً بالسيرفر (الإدارة تعتمد الطلب من هناك)، لذا نُنبه
    // بإشعار أحمر شفاف عند انقطاع الإنترنت بدل محاولة فاشلة.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) {
      const message = 'أنت غير متصل بالإنترنت — تأكد من اتصالك ثم حاول مرة أخرى.';
      showToast('لا يوجد اتصال بالإنترنت', message, 'error', WifiOff);
      setError(message);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const reg = await addRegistration(name.trim(), phone.trim());
      setSuccess(true);
      setName('');
      setPhone('');
      onRegistered(reg);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? '');
      if (/fetch|network|failed to fetch|timeout|abort/i.test(msg)) {
        const message = 'أنت غير متصل بالإنترنت — تأكد من اتصالك ثم حاول مرة أخرى.';
        showToast('لا يوجد اتصال بالإنترنت', message, 'error', WifiOff);
        setError(message);
      } else {
        setError('حدث خطأ أثناء التسجيل. حاول مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-2xl p-6 border border-teal-100">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center shadow-md">
          <UserPlus className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">تسجيل الدخول</h3>
          <p className="text-sm text-slate-500">سجّل بياناتك لتظهر للإدارة</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم</label>
          <div className="relative">
            <UserIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="أدخل اسمك الكامل"
              className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الهاتف</label>
          <div className="relative">
            <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx"
              className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
              dir="ltr"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 animate-fade-in">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 text-green-600 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4" />
            تم التسجيل بنجاح!
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 shadow-md hover:shadow-lg"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <UserPlus className="w-5 h-5" />
              تسجيل
            </>
          )}
        </button>
      </form>
    </div>
  );
}
