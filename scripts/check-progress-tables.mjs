/* فحص سريع (قراءة فقط) لحالة جداول التقدّم في قاعدة البيانات الحقيقية.
 * يتحقق من:
 *   1) هل جدول assignment_progress / study_progress موجود فعلاً؟
 *   2) كم صفاً في assignments فيه completed = true (العمود المشترك)؟
 * الاستخدام: node scripts/check-progress-tables.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(here, '..', file), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const URL_BASE = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;

if (!URL_BASE || !KEY) {
  console.error('ERROR: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

async function probe(table, select, filter = '') {
  const url = `${URL_BASE}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter}`;
  const res = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const tables = [
  ['assignments', 'id,completed', '&completed=eq.true'],
  ['user_assignment_progress', 'assignment_id,user_id,completed', ''],
  ['study_tasks', 'id,completed', '&completed=eq.true'],
  ['user_study_progress', 'task_id,user_id,completed', ''],
];

for (const [table, select, filter] of tables) {
  const r = await probe(table, select, filter);
  if (r.status >= 200 && r.status < 300 && Array.isArray(r.body)) {
    const withFilter = filter ? r.body.length : r.body.length;
    console.log(`OK   ${table.padEnd(20)} rows=${withFilter}`);
    if (r.body.length > 0 && r.body.length <= 5) console.log(`     sample: ${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    const msg = typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 160) : String(r.body).slice(0, 160);
    console.log(`FAIL ${table.padEnd(20)} status=${r.status} ${msg}`);
  }
}

// ── هل معرّف المستخدم فريد فعلاً لكل طالب؟ ────────────────────────────
// إن كان كل الطلاب يتشاركون نفس user_id، فإن أي تصفية بـ .eq('user_id', …)
// ستُظهر حالة الإنجاز نفسها للجميع — وهذا يفسّر الأعراض تماماً.
const regs = await probe('registrations', 'id,name,phone', '');
if (regs.status >= 200 && regs.status < 300 && Array.isArray(regs.body)) {
  console.log(`\nregistrations: ${regs.body.length} rows`);
  const byId = new Map();
  for (const r of regs.body) byId.set(r.id, (byId.get(r.id) ?? 0) + 1);
  const dupes = [...byId.entries()].filter(([, n]) => n > 1);
  console.log(`  distinct ids: ${byId.size}`);
  console.log(`  duplicated ids: ${dupes.length === 0 ? 'none' : JSON.stringify(dupes)}`);
  for (const r of regs.body) console.log(`  id=${r.id} name=${r.name} phone=${r.phone}`);
} else {
  console.log(`\nregistrations: FAIL status=${regs.status}`);
}

