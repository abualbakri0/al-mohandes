// publish.mjs — نشر نسخة APK محلية كإصدار حالِي للبوت (بدون رفعها عبر تيليجرام)
// ============================================================
// الاستخدام:
//   node telegram-bot/publish.mjs --file "المهندس-release.apk" --version 1.1 --code 21
//   node telegram-bot/publish.mjs --file app-debug.apk --version 1.2 --changelog "إصلاحات عامة"
//
// ما يفعله:
//   1. ينسخ ملف APK إلى telegram-bot/releases/المهندس.apk
//   2. يحدّث telegram-bot/data/meta.json (الإصدار/التاريخ)
// ثم يستطيع البوت إرسالها عبر /download وإشعار المشتركين عبر /notify

import { existsSync, copyFileSync, unlinkSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { loadMeta, saveMeta } from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// محلّل بسيط لوسائط سطر الأوامر
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function fmtSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

const args = parseArgs(process.argv);

if (!args.file) {
  console.error('✗ مطلوب وسيط --file <مسار ملف APK>');
  console.error('  مثال: node telegram-bot/publish.mjs --file "المهندس-release.apk" --version 1.1 --code 21');
  process.exit(1);
}

// المسار يُحلّ نسبةً لجذر المشروع (المجلد الأب للمجلد الحالي)
const srcPath = resolve(__dirname, '..', args.file);
if (!existsSync(srcPath)) {
  console.error(`✗ الملف غير موجود: ${srcPath}`);
  process.exit(1);
}

const oldMeta = loadMeta();
const size = statSync(srcPath).size;

// استنتاج رقم الإصدار من اسم الملف إن لم يُمرَّر
let version = args.version;
if (!version) {
  const m = srcPath.match(/(\d+\.\d+(?:\.\d+)?)/);
  version = m ? m[1] : oldMeta.versionName || '1.0';
}
let changelog = args.changelog !== undefined ? args.changelog : (oldMeta.changelog || '');

// إن مُرِّر changelog كملف
if (args.changelogFile) {
  const cf = resolve(__dirname, '..', args.changelogFile);
  if (existsSync(cf)) changelog = readFileSync(cf, 'utf8').trim();
}

const targetPath = join(config.releasesDir, 'المهندس.apk');

// استبدال آمن: انسخ لملف مؤقت ثم احذف القديم ثم سمِّ الجديد
const tmp = join(config.releasesDir, `publish-${Date.now()}.apk`);
copyFileSync(srcPath, tmp);
if (existsSync(targetPath)) unlinkSync(targetPath);
// renameSync يحتاج نفس النظام؛ نستخدم copy+unlink للتوافق مع OneDrive
copyFileSync(tmp, targetPath);
unlinkSync(tmp);

const meta = {
  versionName: version,
  apkFile: 'المهندس.apk',
  changelog,
  updatedAt: new Date().toISOString(),
  size,
};
saveMeta(meta);

console.log('\n✅ تم نشر النسخة:');
console.log(`   الإصدار:     ${meta.versionName}`);
console.log(`   الملف:       ${targetPath}`);
console.log(`\n   شغّل البوت ثم أرسل /notify لإشعار المشتركين بالتحديث.\n`);
