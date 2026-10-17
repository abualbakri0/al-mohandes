import { Sparkles, MessageCircle, Wrench, Heart, Cpu, Phone } from 'lucide-react';

const DEV_NAME = 'أبوبكر الحيدري';
const DEV_NICKNAME = 'أبو شـنـب';
const DEV_PHONE = '779809243';
const WHATSAPP_URL = `https://wa.me/${DEV_PHONE}`;

export default function AboutDeveloperView() {
  return (
    <div className="space-y-6 animate-fade-in-up max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-md">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">عن المطور</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">تعرّف على صانع التطبيق</p>
        </div>
      </div>

      {/* Developer card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* Banner */}
        <div className="relative bg-gradient-to-br from-teal-500 via-cyan-600 to-teal-700 p-6 text-center">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, white 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div className="relative">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center border border-white/25 shadow-lg mb-3">
              <Cpu className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-xl font-bold text-white">المهندس: {DEV_NAME}</h3>
            <p className="text-teal-100 text-sm mt-1">مهندس ميكاترونكس</p>
            <span className="inline-block mt-3 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-medium border border-white/25">
              الملقب بـ {DEV_NICKNAME}
            </span>
          </div>
        </div>

        {/* Body text */}
        <div className="p-6 space-y-4">
          <p className="text-slate-700 dark:text-slate-300 leading-loose text-[15px]">
            تم تطوير هذا التطبيق بكل فخر وتفانٍ بواسطة المهندس:{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-100">{DEV_NAME}</span>{' '}
            مهندس ميكاترونكس، الملقب بـ {DEV_NICKNAME}.
          </p>
          <p className="text-slate-600 dark:text-slate-400 leading-loose text-[15px]">
            لم يكن هذا العمل وليد الصدفة ولا طفرة سهلة؛ بل كان رحلة مليئة بالتحديات والجهد المتواصل،
            حيث تم نحت وهندسة كل تفصيلة فيه — حتى أبسطها — بعناية وعمل شاق لضمان خروج التطبيق بأعلى
            معايير الكفاءة والاحترافية. يجسّد هذا التطبيق مزيجاً فريداً بين دقة التفكير الهندسي
            وابتكار الحلول الرقمية؛ ليكون رفيقاً ذكياً وسلساً وفعّالاً يلبي كافة الاحتياجات الأكاديمية والعملية.
          </p>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-100 dark:border-teal-900">
            <Heart className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            <p className="text-slate-600 dark:text-slate-300 leading-loose text-sm">
              نسعى دائماً لتوظيف التكنولوجيا الحديثة لخدمة الزملاء وتسهيل المهام اليومية، ونرحّب
              بتواصلكم وملاحظاتكم الدائمة للاستمرار في التطوير والتحسين.
            </p>
          </div>
        </div>

        {/* Contact / WhatsApp */}
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">للتواصل والدعم الفني</h4>
          </div>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-bold shadow-md hover:shadow-lg transition-all duration-200 active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            <span>تواصل عبر واتساب</span>
            <span dir="ltr" className="flex items-center gap-1 font-mono text-sm bg-white/20 px-2.5 py-1 rounded-lg">
              <Phone className="w-3.5 h-3.5" />
              {DEV_PHONE}
            </span>
          </a>
        </div>
      </div>

      {/* Footer note */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500 pt-1">
        <Wrench className="w-3.5 h-3.5" />
        <span>صُنع بشغف هندسي · {DEV_NAME}</span>
      </div>
    </div>
  );
}
