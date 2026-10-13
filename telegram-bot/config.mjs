// config.mjs — تحميل الإعدادات لمشروع "المهندس"
// ============================================================
// يقرأ الإعدادات من متغيّرات البيئة، أو من ملف .env داخل هذا المجلد،
// أو من ملف .env في جذر المشروع (نفس ملف Vite).
//
// المتغيّرات المطلوبة:
//   BOT_TOKEN   توكن البوت من @BotFather            (إلزامي)
//   ADMIN_IDS   معرفات تليجرام للمشرفين (مفصولة بفاصلة) (إلزامي للنشر/البث)
// المتغيّرات الاختيارية:
//   APP_NAME    اسم التطبيق المعروض (افتراضي: المهندس)
//   DOWNLOAD_URL رابط تنزيل خارجي بديل (إن وُجد)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// محلّل بسيط لملفات .env (بدون اعتماديات)
function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // إزالة علامات التنصيص المحيطة إن وجدت
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// نجمع الإعدادات: متغيّرات العملية أولاً، ثم .env المحلي، ثم .env الجذري
function loadEnvFile() {
  const files = [
    join(__dirname, '.env'),            // telegram-bot/.env
    resolve(__dirname, '..', '.env'),   // جذر المشروع
  ];
  const merged = {};
  // نقرأ بالعكس حتى يكون الأقرب (الأول) هو الأولوية، لذلك نعكس
  for (const f of files.reverse()) {
    if (existsSync(f)) {
      try {
        Object.assign(merged, parseEnv(readFileSync(f, 'utf8')));
      } catch {
        /* نتجاهل أخطاء القراءة */
      }
    }
  }
  return merged;
}

const fileEnv = loadEnvFile();

function env(key, fallback) {
  if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
  if (fileEnv[key] !== undefined && fileEnv[key] !== '') return fileEnv[key];
  return fallback;
}

const token = env('BOT_TOKEN', '');
const adminRaw = env('ADMIN_IDS', '');
const adminIds = adminRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => Number(s))
  .filter((n) => !Number.isNaN(n));

export const config = {
  botToken: token,
  adminIds,
  appName: env('APP_NAME', 'المهندس'),
  downloadUrl: env('DOWNLOAD_URL', ''),
  iosUrl: env('IOS_URL', ''),
  // مسارات الملفات المحلية
  dataDir: join(__dirname, 'data'),
  releasesDir: join(__dirname, 'releases'),
  subscribersFile: join(__dirname, 'data', 'subscribers.json'),
  metaFile: join(__dirname, 'data', 'meta.json'),
};

export function isAdmin(userId) {
  return config.adminIds.includes(Number(userId));
}

// فحص الإعدادات الأساسية
export function assertConfigured() {
  if (!token) {
    console.error(
      '\n✗ BOT_TOKEN غير معرّف.\n' +
        '  1. أنشئ بوت عبر @BotFather في تليجرام واحصل على التوكن.\n' +
        '  2. ضعه في ملف telegram-bot/.env بالشكل: BOT_TOKEN=123456:ABC...\n' +
        '     (و ADMIN_IDS=معرّفك الرقمي).\n'
    );
    process.exit(1);
  }
  if (adminIds.length === 0) {
    console.warn(
      '⚠ تحذير: لا يوجد ADMIN_IDS. أوامر الأدمن (رفع نسخة/بث) ستكون معطّلة.'
    );
  }
}
