#!/usr/bin/env node
/**
 * check-secrets.mjs — حارس الأسرار قبل الدفع إلى Git
 * ============================================================
 * يفحص الملفات **المتتبَّعة** في Git فقط، ويفشل (exit 1) عند أي أثر لأحد:
 *   • ملفات التوقيع: *.keystore / *.jks / *.bks / *.p12 / keystore.properties
 *   • ملفات البيئة: .env (مع السماح بـ .env.example)
 *   • تقارير R8/ProGuard: mapping.txt
 *   • كتلة مفتاح خاص:  -----BEGIN ... PRIVATE KEY-----
 *   • كلمة سر متجر المفاتيح (storePassword=)
 *   • مفتاح Supabase سرّي: sb_secret_...
 *   • JWT بدور service_role (المفتاح الذي يتجاوز RLS)
 *   • توكن بوت تيليجرام
 *   • مفتاح Google/Firebase
 *
 * التشغيل:  node scripts/check-secrets.mjs
 * المتوقع الآن: يفشل عن قصد حتى تُنظَّف الملفات المسرَّبة من تاريخ المستودع
 * (انظر SECURITY.md).
 * ============================================================
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const SELF = 'scripts/check-secrets.mjs';

/** أسماء الملفات التي لا يجوز أن تكون متتبَّعة في Git. */
const FORBIDDEN_FILES = [
  { re: /(^|\/)keystore\.properties(\.[^/]+)?$/i, why: 'keystore passwords' },
  { re: /\.(keystore|jks|bks|p12|pfx)$/i, why: 'app signing key' },
  { re: /(^|\/)mapping\.txt$/i, why: 'R8 mapping (exposes class/member names)' },
  { re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/i, why: 'real environment variables' },
  { re: /(^|\/)google-services\.json$/i, why: 'Firebase config' },
  { re: /(^|\/)serviceAccount.*\.json$/i, why: 'service account credentials' },
];

/** أنماط محتوى خطرة (تُتجاهل في ملفات التوثيق .md). */
const FORBIDDEN_CONTENT = [
  { re: /^\s*storePassword\s*=/m, why: 'keystore password' },
  { re: /sb_secret_[A-Za-z0-9_-]{10,}/, why: 'Supabase secret key' },
  { re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/, why: 'Telegram bot token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, why: 'Google / Firebase API key' },
  { re: /"private_key"\s*:\s*"-----BEGIN/, why: 'Firebase service-account private key' },
];

/**
 * PEM حقيقي = ترويسة يتبعها سطر جسم base64 (لا التعليقات التي تذكر الصيغة).
 * تعليق في push-notify يذكر "-----BEGIN PRIVATE KEY-----" كنص شرح → لا يطابق.
 */
const PEM_RE = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[^\n]*\n\s*([A-Za-z0-9+/=]{40,})/;

const MAX_BYTES = 512 * 1024;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function decodeJwtRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    const role = /"role"\s*:\s*"([^"]+)"/.exec(json);
    return role ? role[1] : null;
  } catch {
    return null;
  }
}

const findings = [];

for (const file of trackedFiles()) {
  if (file === SELF) continue; // الأنماط نفسها مكتوبة هنا

  for (const rule of FORBIDDEN_FILES) {
    if (rule.re.test(file)) {
      findings.push({ file, line: 0, why: rule.why });
    }
  }

  if (/\.md$/i.test(file)) continue; // التوثيق قد يحتوي أمثلة

  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue; // ملف محذوف من القرص لكنه ما زال في الفهرس
  }
  if (size === 0 || size > MAX_BYTES) continue;

  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // ملف ثنائي
  }
  if (text.includes('\u0000')) continue; // ثنائي

  const pem = PEM_RE.exec(text);
  if (pem) {
    const line = text.slice(0, pem.index).split(/\r?\n/).length;
    findings.push({ file, line, why: 'private key block' });
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of FORBIDDEN_CONTENT) {
      if (rule.re.test(line)) findings.push({ file, line: index + 1, why: rule.why });
    }
    for (const match of line.match(JWT_RE) ?? []) {
      if (decodeJwtRole(match) === 'service_role') {
        findings.push({ file, line: index + 1, why: 'JWT with service_role (bypasses RLS)' });
      }
    }
  });
}

if (findings.length === 0) {
  console.log('OK — no secrets tracked in Git.');
  process.exit(0);
}

const unique = new Map();
for (const f of findings) unique.set(`${f.file}:${f.line}:${f.why}`, f);

console.error('\nFAILED — secrets are tracked in Git. Do NOT push this:\n');
for (const f of unique.values()) {
  console.error(`  * ${f.file}${f.line ? `:${f.line}` : ''}  ->  ${f.why}`);
}
console.error(
  '\nFix:\n' +
    '  1) git rm --cached <file>  then add it to .gitignore\n' +
    '  2) If it was ever pushed, treat it as leaked: rotate it now\n' +
    '     (new keystore, revoke BOT_TOKEN, change dev_password, ...)\n' +
    '  3) Purge it from history with git filter-repo/BFG, then force-push\n' +
    '     (see SECURITY.md). This scan covers tracked files only, not history.\n'
);
process.exit(1);
