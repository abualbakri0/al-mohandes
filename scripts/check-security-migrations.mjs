// Permanent regression check for the security migrations (anon key only).
// Run: node scripts/check-security-migrations.mjs
// Exit code 0 = every measured expectation held.
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.log('MISSING_ENV');
  process.exit(1);
}
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const rows = [];
const record = (label, expect, status, body) =>
  rows.push({ label, expect, status, body: body.replace(/\s+/g, ' ').slice(0, 100) });

async function get(label, path, expect) {
  const r = await fetch(`${URL_}${path}`, { headers: H });
  record(label, expect, r.status, await r.text());
}

async function rpc(label, fn, args, expect) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  record(label, expect, r.status, await r.text());
}

// 1) الجداول السرّية: ما زالت مغلقة للقراءة (وبالتالي للحذف/التعديل بفلتر)
await get('GET push_tokens', '/rest/v1/push_tokens?select=*&limit=1', '401');
await get('GET user_passwords', '/rest/v1/user_passwords?select=*&limit=1', '401');
await get('GET web_push_subscriptions', '/rest/v1/web_push_subscriptions?select=*&limit=1', '401');
await get('GET notifications (مفتوح بقرار المالك)', '/rest/v1/notifications?select=id&limit=1', '200');

// 2) دوال إلغاء التسجيل (تعويض الحذف بفلتر)
await rpc('rpc unregister_push_token', 'unregister_push_token', { p_token: '__probe_missing__' }, '200');
await rpc('rpc unregister_web_push', 'unregister_web_push', { p_endpoint: '__probe_missing__' }, '200');
await rpc('rpc unregister_push_token (وسيط فارغ)', 'unregister_push_token', { p_token: '   ' }, '200');

// 3) مسار كلمة المرور الحيّ ما زال يعمل
await rpc('rpc password_status', 'password_status', { p_phone: '__probe__' }, '200');
await rpc('rpc verify_password (بيانات خاطئة)', 'verify_password', { p_phone: '__probe__', p_password: 'x' }, '200');
//    20261024120000: قراءة حالة حدّ المحاولات (تفصل «كلمة خطأ» عن «أوقفت المحاولات»)
await rpc('rpc password_login_blocked', 'password_login_blocked', { p_phone: '__probe__' }, '200');
//    ونفس الهجرة: حارس المدخلات في register_student ما زال يرفض البيانات الفارغة
await rpc('rpc register_student (بيانات فارغة → 22023)', 'register_student', { p_name: '', p_phone: '' }, '400');

// 4) دوال التجزئة يجب ألا تكون مناحة لـanon
//    404 = غير مكشوفة أصلاً (مخفية عن الدور) · 401/403 = موجودة ومحبوسة. كلاهما مقبول.
await rpc('rpc app_password_hash', 'app_password_hash', { p_phone: 'a', p_password: 'b' }, '401|403|404');
await rpc('rpc password_hash_make', 'password_hash_make', { p_password: 'x' }, '401|403|404');
await rpc('rpc password_hash_check', 'password_hash_check', { p_phone: 'a', p_password: 'b', p_stored: 'c' }, '401|403|404');

let fails = 0;
for (const r of rows) {
  const ok = new RegExp(`^(${r.expect})$`).test(String(r.status));
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(r.status).padEnd(4)} ${r.label}\n        متوقع ${r.expect} | ${r.body}`);
}
console.log(`\n${rows.length - fails}/${rows.length} ناجح`);
process.exit(fails ? 1 : 0);
