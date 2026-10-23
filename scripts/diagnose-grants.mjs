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
  let message = '';
  try {
    const parsed = JSON.parse(text);
    code = parsed.code ?? '';
    message = parsed.message ?? '';
  } catch {
    /* empty body on 204 */
  }
  return { status: r.status, code, message, text };
};

/**
 * A 42501 has three different meanings and only one of them is fixed by a GRANT:
 *   "permission denied for table X"                 → the privilege is missing
 *   "permission denied for column id"               → UPDATE/DELETE's WHERE needs SELECT(id)
 *   "new row violates row-level security policy"    → GRANT is fine, RLS/policy is the blocker
 * Printing the reason is what makes the matrix actionable.
 */
const verdict = (r) => {
  const msg = r.message.toLowerCase();
  if (msg.includes('permission denied for column')) return `DENIED:col (${r.code || r.status})`;
  if (msg.includes('permission denied for table')) return `DENIED:table (${r.code || r.status})`;
  if (msg.includes('row-level security')) return 'RLS blocked';
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

// ── developer RPCs (the path the app uses after 20261023170000) ─────────────
console.log('\ndeveloper write RPCs (no grant attached → 42501 "developer grant required" is EXPECTED):');
for (const fn of ['approve_registration', 'delete_registration']) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_id: ZERO }),
  });
  const text = await r.text();
  const missing = text.includes('PGRST202') || text.includes('does not exist');
  console.log(`  ${fn.padEnd(24)} ${missing ? 'MISSING — migration 20261023170000 not applied' : `${r.status} ${text.slice(0, 90)}`}`);
}

// ── privacy must stay closed: full-row reads are still refused ──────────────
console.log('\nprivacy check (must stay 401 — no student data readable):');
for (const t of ['registrations', 'feedback_messages']) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers });
  console.log(`  GET ${t.padEnd(22)} ${r.status}`);
  // column-level SELECT(id) is required for the WHERE clause; it must not leak rows
  const idr = await fetch(`${URL_}/rest/v1/${t}?select=id&limit=1`, { headers });
  const body = await idr.text();
  console.log(`  GET ${t.padEnd(22)} ?select=id  ${idr.status}  ${body.slice(0, 40) || '(empty)'}`);
}
