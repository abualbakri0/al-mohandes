import { config } from './config.mjs';
import { getRaw, setRaw } from './db.mjs';

// ----------------- القيم الافتراضية -----------------
export function defaultSettings() {
  return {
    appName: config.appName,
    texts: {
      welcome:
        'أهلاً بك يا بشمهندس 🎓\n\n' +
        'يسعدنا انضمامك إلى تطبيق {app}\n' +
        'بوابتك الجامعية الأولى لإدارة جداولك، ومتابعة موادك الدراسية، وتسهيل مسيرتك الأكاديمية بكل سلاسة واحترافية.\n\n' +
        'اختر من القائمة أدناه لنبدأ:',
      help:
        '💬 <b>تواصل معنا</b>\n\n' +
        'لأي استفسار أو دعم فني تواصل عبر المعرف:\n' +
        '@rbkke',
      about:
        '👨‍💻 <b>عن المطور</b>\n\n' +
        '📌 <b>المطور: المهندس أبوبكر الحيدري (أبو شنب)</b>\n\n' +
        '🧭 تطبيق {app} — البوابة الأكاديمية والتقنية لطلاب هندسة الميكاترونكس والهندسة الكهربائية.\n\n' +
        'لأي استفسار أو دعم فني تواصل عبر المعرف:\n' +
        '@rbkke',
      noVersion:
        'ℹ️ لا توجد نسخة منشورة بعد.\nاستخدم زر ⬇️ تنزيل التطبيق بالأسفل 👇',
      androidUnavailable:
        '😕 لا توجد نسخة أندرويد متاحة للتنزيل حالياً.\nيرجى المحاولة لاحقاً.',
      iosUnavailable:
        '😕 رابط نسخة الآيفون غير متاح حالياً.\nسيتم إضافته قريباً — تابعنا للتفاصيل.',
    },
    links: {
      iosUrl: config.iosUrl || '',
      downloadUrl: config.downloadUrl || '',
    },
    // تعريفات أزرار اللوحة الثابتة (ReplyKeyboard)
    // الإجراءات الممكنة: download | update | android | ios | about | help | home | version | url
    buttons: [
      { id: 'download', action: 'download', label: '⬇️ تنزيل التطبيق', enabled: true },
      { id: 'update', action: 'update', label: '🔄 تحديث التطبيق', enabled: true },
      { id: 'android', action: 'android', label: '🤖 أندرويد', enabled: true },
      { id: 'ios', action: 'ios', label: '🍎 آيفون', enabled: true },
      { id: 'about', action: 'about', label: '👨‍💻 عن المطور', enabled: true },
      { id: 'help', action: 'help', label: '💬 تواصل', enabled: true },
      { id: 'home', action: 'home', label: '🏠 القائمة الرئيسية', enabled: false },
      { id: 'version', action: 'version', label: '📦 الإصدار الحالي', enabled: false },
    ],
    description: config.description,
    shortDescription: config.shortDescription,
    updatedAt: null,
  };
}

// دمج آمن: القيم المخزّنة تُقدَّم على الافتراضية، مع ملء أي حقول ناقصة
export function getSettings() {
  const d = defaultSettings();
  const raw = getRaw('settings'); // من الذاكرة (Supabase/محلي)
  if (!raw) return d;
  return {
    ...d,
    ...raw,
    texts: { ...d.texts, ...(raw.texts || {}) },
    links: { ...d.links, ...(raw.links || {}) },
    buttons:
      Array.isArray(raw.buttons) && raw.buttons.length ? raw.buttons : d.buttons,
  };
}

export function saveSettings(settings) {
  settings.updatedAt = new Date().toISOString();
  setRaw('settings', settings); // يُحفظ في Supabase (أو محلياً) فوراً
  return settings;
}
