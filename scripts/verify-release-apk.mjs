/**
 * فحص إصدار الأندرويد النهائي (للقراءة فقط) — قبل كل نشر:
 *   node scripts/verify-release-apk.mjs [path-to.apk]
 *
 * يتحقق من:
 *  1. الحزمة/الإصدار/رقم versionCode.
 *  2. التوقيع (v1/v2/v3) وبصمة شهادة التوقيع.
 *  3. أن ملفات الويب داخل الـ APK مطابقة تماماً لمجلد dist (لا نقص/زيادة).
 *  4. أن index.html يشير إلى حزمة JS موجودة فعلاً.
 *  5. قواعد الـ Service Worker: كاش جديد + عدم اعتراض التطبيق الأصلي + عدم
 *     إرجاع Response.error() (وهو ما كان يُعطّل فتح التطبيق).
 *  6. علامات الكود الأصلي (MainActivity) داخل classes.dex.
 *
 * ملاحظة: R8 يحذف استدعاءات Log في إصدار release، لذلك نبحث عن النصوص
 * المُستهلكة فعلياً (أسماء الملفات/المفاتيح) لا عن نصوص السجلات.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APK = path.resolve(process.argv[2] ?? 'android/app/build/outputs/apk/release/app-release.apk');
const BUILD_TOOLS = path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'build-tools', '36.0.0');
let failures = 0;
const ok = (label) => console.log(`  ✓ ${label}`);
const bad = (label) => { console.log(`  ✗ ${label}`); failures += 1; };

if (!existsSync(APK)) {
  console.error(`✗ APK not found: ${APK}`);
  process.exit(1);
}
console.log(`APK: ${APK} (${(statSync(APK).size / 1024 / 1024).toFixed(2)} MB)\n`);

// ── 1) manifest ────────────────────────────────────────────────────────────
const badging = execFileSync(path.join(BUILD_TOOLS, 'aapt2.exe'), ['dump', 'badging', APK], { encoding: 'utf8' });
console.log(`package      : ${/package: name='([^']+)'/.exec(badging)?.[1]}`);
console.log(`versionCode  : ${/versionCode='(\d+)'/.exec(badging)?.[1]}`);
console.log(`versionName  : ${/versionName='([^']+)'/.exec(badging)?.[1]}`);
console.log(`minSdk/target: ${/sdkVersion:'(\d+)'/.exec(badging)?.[1]} / ${/targetSdkVersion:'(\d+)'/.exec(badging)?.[1]}`);

// ── 2) signature ───────────────────────────────────────────────────────────
const certs = execFileSync('cmd.exe', ['/c', path.join(BUILD_TOOLS, 'apksigner.bat'), 'verify', '--print-certs', '-v', APK], { encoding: 'utf8' });
console.log('\nSignature:');
for (const line of certs.split(/\r?\n/).filter((l) => /^Verified using|SHA-256 digest|DN:/.test(l.trim()))) {
  console.log('  ' + line.trim());
}
const sha = /SHA-256 digest: ([0-9a-f]{64})/.exec(certs)?.[1];


// ── 3-6) web assets, service worker, native markers ────────────────────────
const tmp = mkdtempSync(path.join(os.tmpdir(), 'apkverify-'));
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem;` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${APK}');` +
    `foreach($e in $z.Entries){` +
    `  $n=$e.FullName;` +
    `  if($n -like 'assets/public/*' -or $n -like 'classes*.dex' -or $n -eq 'assets/capacitor.config.json'){` +
    `    $out=Join-Path '${tmp}' $n; $d=Split-Path $out -Parent;` +
    `    if(!(Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};` +
    `    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,$out,$true)` +
    `  }` +
    `}; $z.Dispose()`], { stdio: 'ignore' });

  const pub = path.join(tmp, 'assets', 'public');
  const walk = (dir, base = '') => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name), `${base}${d.name}/`) : [`${base}${d.name}`]);
  const inApk = walk(pub).sort();

  console.log('\nWeb assets:');
  if (existsSync(path.join(tmp, 'assets', 'capacitor.config.json'))) ok('capacitor.config.json present');
  else bad('assets/capacitor.config.json missing');

  if (existsSync('dist')) {
    const dist = walk('dist').sort();
    const missing = dist.filter((f) => !inApk.includes(f));
    const extra = inApk.filter((f) => !dist.includes(f));
    if (missing.length) bad(`missing in APK: ${missing.join(', ')}`);
    else ok(`all ${dist.length} dist files packaged`);
    if (extra.length) console.log(`  · extra (normal for Capacitor): ${extra.join(', ')}`);
  } else {
    console.log('  · dist/ not found — skipped comparison');
  }

  const html = readFileSync(path.join(pub, 'index.html'), 'utf8');
  const bundle = /(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1];
  if (bundle && existsSync(path.join(pub, 'assets', bundle))) ok(`index.html → ${bundle} (present)`);
  else bad('index.html bundle reference broken');

  const sw = readFileSync(path.join(pub, 'sw.js'), 'utf8');
  const swRules = [
    ['cache name bumped (not v2)', /const CACHE = 'mohanndes-pwa-v\d+';/.test(sw) && !sw.includes('mohanndes-pwa-v2')],
    ['native app never intercepted', sw.includes('IS_NATIVE_APP') && /if \(IS_NATIVE_APP\) return;/.test(sw)],
    ['worker self-destructs on localhost', sw.includes('registration.unregister()')],
    ['never returns Response.error()', !/return Response\.error\(\)/.test(sw)],
  ];
  console.log('\nService worker:');
  for (const [label, pass] of swRules) (pass ? ok : bad)(label);

  const dex = readdirSync(tmp)
    .filter((f) => /^classes.*\.dex$/.test(f))
    .map((f) => readFileSync(path.join(tmp, f)).toString('latin1'))
    .join('');
  const nativeRules = [
    ['clears "Service Worker" storage', dex.includes('Service Worker')],
    ['first-paint watchdog prefs', dex.includes('app_first_paint') && dex.includes('recovered_v')],
    ['__APP_READY__ probe wired', dex.includes('__APP_READY__')],
  ];
  console.log('\nNative shell (classes.dex):');
  for (const [label, pass] of nativeRules) (pass ? ok : bad)(label);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} check(s) failed`}`);
if (sha) console.log(`Signing cert SHA-256: ${sha}`);
process.exit(failures === 0 ? 0 : 1);
