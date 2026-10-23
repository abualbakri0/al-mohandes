import { useState, useEffect, useCallback } from 'react';
import { Users, Trash2, Loader2, User as UserIcon, Phone, Search, Cpu, Zap, CheckCircle2, Clock, KeyRound } from 'lucide-react';
import { displayDepartment, type Registration } from '@/lib/supabase';
import { fetchRegistrations, deleteRegistration, approveRegistration, resetUserPassword, describeWriteError } from '@/lib/api';
import { fetchWithCache } from '@/lib/offlineStore';
import { useToast } from '@/components/ToastProvider';

export default function RegistrationsView({ isDeveloper }: { isDeveloper: boolean }) {
  const { showToast } = useToast();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resettingId, setResettingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchWithCache<Registration>('registrations', undefined, fetchRegistrations);
      setRegistrations(result.rows);
    } catch {
      // Keep the last successful result visible if this refresh fails offline.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * كل صفوف الرقم الواحد تُعتمد معاً.
   *
   * السبب (مقيس على القاعدة الحيّة): شاشة الدخول تقرأ صفّاً **واحداً** للرقم —
   * الأقدم — بينما هذه القائمة تُظهر الأحدث أولاً. فإن سجّل الطالب مرتين (نقرة
   * مزدوجة، أو إعادة محاولة بعد فشل) صار للرقم صفّان، وكان اعتماد الصفّ الظاهر
   * لا يحرّك شاشة الدخول ⇒ «بانتظار الموافقة» إلى الأبد رغم الاعتماد.
   * الاعتماد الآن يشمل الرقم كله، فيتحرّر الطالب فوراً حتى قبل تنفيذ الهجرة
   * 20261024120000 (وبعدها تصبح العملية تكراراً آمناً: changed = 0).
   */
  const handleApprove = async (reg: Registration) => {
    const targets = registrations.filter((r) => r.phone === reg.phone && !r.is_approved);
    if (targets.length === 0) return;
    try {
      for (const target of targets) {
        await approveRegistration(target.id);
      }
      const ids = new Set(targets.map((r) => r.id));
      setRegistrations((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, is_approved: true } : r)));
      if (targets.length > 1) {
        showToast('تم الاعتماد', `اعتُمد الرقم ${reg.phone} بصفوفه كلها (${targets.length}).`, 'success');
      }
    } catch (err) {
      // كان الخطأ يُبتلع هنا، فيبدو الزر كأنه «لا يفعل شيئاً». المعالجة الأكثر
      // شيوعاً: صلاحية UPDATE ناقصة (42501) — تشرحها الرسالة للمطوّر.
      showToast('تعذّر اعتماد المسجّل', describeWriteError(err, 'لم يتم الاعتماد. حاول مرة أخرى.'), 'error');
      // بعض الصفوف قد تكون اعتُمدت قبل الخطأ — نعيد القراءة من الخادم.
      load();
    }
  };

  const handleResetPassword = async (reg: Registration) => {
    if (!window.confirm(`إعادة تعيين كلمة مرور ${reg.name}؟\nستصبح كلمة المرور مؤقتاً هي رقم هاتفه، وسيُطلب منه إنشاء كلمة مرور جديدة عند الدخول.`)) {
      return;
    }
    setResettingId(reg.id);
    try {
      await resetUserPassword(reg.id, reg.phone);
      setRegistrations((prev) => prev.map((r) => r.id === reg.id ? { ...r, must_change_password: true } : r));
    } catch (err) {
      showToast('تعذّر إعادة تعيين كلمة المرور', describeWriteError(err, 'لم تتم إعادة التعيين. حاول مرة أخرى.'), 'error');
    } finally {
      setResettingId(null);
    }
  };

  /**
   * حذف المسجّل يحذف **كل صفوف رقمه** + كلمة مروره + مفاتيح جلسته.
   *
   * في النسخة القديمة من `delete_registration` (قبل 20261024120000) كان الحذف
   * لصفّ واحد فقط، فبقي صفّ آخر للرقم يحمل كلمة المرور ⇒ إعادة التسجيل ترتدّ
   * بـ`current_required`. الحذف الآن شامل، وهو ما تفعله الهجرة على الخادم أيضاً.
   */
  const handleDelete = async (reg: Registration) => {
    const targets = registrations.filter((r) => r.phone === reg.phone);
    if (targets.length === 0) return;
    if (
      targets.length > 1 &&
      !window.confirm(
        `الرقم ${reg.phone} له ${targets.length} صفوف مسجّلة.\nسيُحذف الرقم بكل صفوفه وكلمة مروره. متابعة؟`,
      )
    ) {
      return;
    }
    try {
      for (const target of targets) {
        await deleteRegistration(target.id);
      }
      const ids = new Set(targets.map((r) => r.id));
      setRegistrations((prev) => prev.filter((r) => !ids.has(r.id)));
      if (targets.length > 1) {
        showToast('تم الحذف', `حُذف الرقم ${reg.phone} بصفوفه كلها (${targets.length}).`, 'success');
      }
    } catch (err) {
      // نفس السبب المحتمل: DELETE غير ممنوح للدور (42501) قبل أن تصل RLS.
      showToast('تعذّر حذف المسجّل', describeWriteError(err, 'لم يتم الحذف. حاول مرة أخرى.'), 'error');
      // بعض الصفوف قد تكون حُذفت قبل الخطأ — نعيد القراءة من الخادم.
      load();
    }
  };

  const filtered = registrations.filter(
    (r) =>
      r.name.includes(search) ||
      r.phone.includes(search)
  );

  const sorted = [...filtered].sort((a, b) => {
    if (a.is_approved !== b.is_approved) return a.is_approved ? 1 : -1;
    return 0;
  });

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center shadow-md">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800">المسجلون</h2>
          <p className="text-sm text-slate-500">
            {registrations.length} شخص مسجل
            {registrations.filter((r) => !r.is_approved).length > 0 && (
              <span className="text-amber-500 font-medium"> — {registrations.filter((r) => !r.is_approved).length} بانتظار الموافقة</span>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو رقم الهاتف..."
              className="w-full pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent transition-all"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">
                {registrations.length === 0 ? 'لا يوجد مسجلون بعد.' : 'لا نتائج للبحث.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-slate-100">
                {sorted.map((reg) => (
                  <div
                    key={reg.id}
                    className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors group animate-slide-in"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 ${
                        reg.is_approved ? 'bg-gradient-to-br from-teal-400 to-cyan-500' : 'bg-gradient-to-br from-amber-400 to-orange-400'
                      }`}>
                        {reg.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <UserIcon className="w-4 h-4 text-slate-400" />
                          <h4 className="font-semibold text-slate-800">{reg.name}</h4>
                          {reg.department && (
                            <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                              reg.department === 'ميكاترونكس'
                                ? 'bg-cyan-100 text-cyan-700'
                                : reg.department === 'كهربائية'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {reg.department === 'ميكاترونكس' ? <Cpu className="w-3 h-3" /> : reg.department === 'كهربائية' ? <Zap className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                              {displayDepartment(reg.department)}
                            </span>
                          )}
                          {!reg.is_approved && (
                            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              <Clock className="w-3 h-3" />
                              بانتظار الموافقة
                            </span>
                          )}
                          {reg.is_approved && (
                            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                              <CheckCircle2 className="w-3 h-3" />
                              معتمد
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Phone className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-500" dir="ltr">{reg.phone}</span>
                        </div>
                      </div>
                    </div>
                    {isDeveloper && (
                      <div className="flex items-center gap-1">
                        {!reg.is_approved && (
                          <button
                            onClick={() => handleApprove(reg)}
                            className="p-2 rounded-lg text-green-500 hover:bg-green-50 transition-all"
                            title="موافقة"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                        )}
                        {reg.is_approved && (
                          <button
                            onClick={() => handleResetPassword(reg)}
                            disabled={resettingId === reg.id}
                            className="p-2 rounded-lg text-amber-500 hover:bg-amber-50 transition-all disabled:opacity-50"
                            title="إعادة تعيين كلمة المرور (تصبح رقم الهاتف)"
                          >
                            {resettingId === reg.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(reg)}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                          title="حذف"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
