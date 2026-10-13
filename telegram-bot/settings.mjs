// settings.mjs — إعدادات البوت القابلة للتعديل من لوحة التحكم (تخزين JSON خفيف)
// ============================================================
// كل التعديلات من لوحة تحكم المشرف تُحفظ هنا فوراً وتُقرأ مع كل رسالة،
// أي بدون إعادة نشر الكود أو إعادة تشغيل البوت.
//
// البنية:
// {
//   appName,            اسم التطبيق المعروض
//   texts: {...}        النصوص الظاهرة للمستخدمين
//   links: {...}        الروابط (iOS / تنزيل بديل)
//   buttons: [...]      تعريفات أزرار اللوحة (نص + إجراء + تفعيل)
//   description,        وصف البوت الكامل (About)
//   shortDescription,   الوصف المختصر (البحث)
//   updatedAt           آخر وقت حفظ
// }
//
// ملاحظة: طبقة التخزين معزولة هنا عمداً — لاستبدالها بـ Supabase لاحقاً
// يكفي تعديل هذا الملف فقط (نفس الدوال: getSettings / saveSettings).

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

const settingsFile = join(config.dataDir, 'settings.json');

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
  try {
    if (!existsSync(settingsFile)) return d;
    const raw = JSON.parse(readFileSync(settingsFile, 'utf8'));
    return {
      ...d,
      ...raw,
      texts: { ...d.texts, ...(raw.texts || {}) },
      links: { ...d.links, ...(raw.links || {}) },
      buttons:
        Array.isArray(raw.buttons) && raw.buttons.length
          ? raw.buttons
          : d.buttons,
    };
  } catch (e) {
    console.error('تعذّر قراءة settings.json، تم استخدام القيم الافتراضية:', e.message);
    return d;
  }
}

export function saveSettings(settings) {
  const dataDir = config.dataDir;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  settings.updatedAt = new Date().toISOString();
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}