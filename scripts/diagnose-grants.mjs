// Diagnostic #4 (read-only): table privilege matrix for the anon role.
// Probes never touch a real row:
//   • UPDATE/DELETE always filter on the all-zero UUID → 0 rows when allowed.
//   • INSERT sends an invalid uuid for the PK → 22P02 before any row is made.
// Interpretation:
//   204/0 rows  → privilege present (RLS filtered it because no dev token)
//   401 42501   → the TABLE privilege is missing → the developer's action fails
//
// Usage: node scripts/diagnose-grants.mjs
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const ZERO = '00000000-0000-0000-0000-000000000000';
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const TABLES = [
  'registrations',
  'feedback_messages',
  'lectures',
  'assignments',
  'exams',
  'reference_materials',
  'study_tasks',
  'notifications',
  'app_settings',
];

const probe = async (method, table, body, query = '') => {
  const r = await fetch(`${URL_}/rest/v1/${table}${query}`, {
    method,
    headers: { ...headers, Prefer: 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let code = '';
  try {
    code = JSON.parse(text).code ?? '';
  } catch {
    /* empty body on 204 */
  }
  return { status: r.status, code, text };
};

const verdict = (r) => {
  if (r.status === 401 || r.status === 403) return `MISSING (${r.code || r.status})`;
  if (r.status === 204 || r.status === 201) return 'ok (0 rows)';
  if (r.code === '22P02' || r.code === '23502' || r.code === '23503') return 'ok (rejected by type)';
  return `${r.status} ${r.code}`;
};

console.log(`backend: ${URL_}\n`);
console.log('table                  INSERT                 UPDATE                 DELETE');
console.log('─'.repeat(86));

for (const t of TABLES) {
  const ins = await probe('POST', t, { id: 'not-a-uuid' });
  const upd = await probe('PATCH', t, { id: null }, `?id=eq.${ZERO}`);
  const del = await probe('DELETE', t, null, `?id=eq.${ZERO}`);
  console.log(`${t.padEnd(22)} ${verdict(ins).padEnd(22)} ${verdict(upd).padEnd(22)} ${verdict(del)}`);
}
