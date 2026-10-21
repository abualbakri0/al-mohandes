/* فحص سريع (قراءة فقط، بلا أي كتابة) لحالة RPCs العزل في القاعدة الحقيقية.
 * لا يكتب أي صف: كل الاستدعاءات مُصمَّمة لترجع bad_key/bad_token.
 * الاستخدام: node scripts/check-progress-rpcs.mjs
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
const BASE = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
if (!BASE || !KEY) {
  console.error('ERROR: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const ZERO = '00000000-0000-0000-0000-000000000000';

async function rpc(fn, args) {
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 300) };
}

async function rest(path) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 200) };
}

const checks = [
  ['progress_fetch (bad key)', () => rpc('progress_fetch', { p_user_id: ZERO, p_key: ZERO, p_kind: 'assignment' })],
  ['progress_counts (bad token)', () => rpc('progress_counts', { p_kind: 'assignment', p_dev_token: 'x' })],
  ['progress_set (bad key)', () =>
    rpc('progress_set', { p_user_id: ZERO, p_key: ZERO, p_kind: 'assignment', p_item: ZERO, p_completed: false })],
  ['table user_assignment_progress direct', () => rest('user_assignment_progress?select=assignment_id&limit=1')],
  ['table user_study_progress direct', () => rest('user_study_progress?select=task_id&limit=1')],
  ['table student_keys direct', () => rest('student_keys?select=user_id&limit=1')],
  ['shared assignments.completed=true rows', () => rest('assignments?select=id&completed=eq.true')],
  ['shared study_tasks.completed=true rows', () => rest('study_tasks?select=id&completed=eq.true')],
];

for (const [name, fn] of checks) {
  const r = await fn();
  console.log(`[${r.status}] ${name}\n      ${r.body}`);
}
