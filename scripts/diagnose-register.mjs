// Diagnostic (read-only): why does a NEW registration fail, and why can the
// developer not approve/delete a registration?
//
// Nothing is written:
//   • register_student is called with EMPTY strings → the function's own guard
//     raises 22023 before any INSERT.
//   • PATCH/DELETE target the all-zero UUID → no row can match.
// The HTTP status + PostgREST error code tell us whether the failure is a
// missing privilege (42501), a missing function (PGRST202), or RLS (204/0 rows).
//
// Usage: node scripts/diagnose-register.mjs
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

const ZERO = '00000000-0000-0000-0000-000000000000';
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const short = (s) => (s.length > 220 ? s.slice(0, 220) + '…' : s);
const line = (label, status, body) => console.log(`${String(status).padEnd(4)}${label.padEnd(50)}${short(body)}`);

const post = async (url, body, extra = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
};
const verb = async (method, url, body, extra = {}) => {
  const r = await fetch(url, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.text() };
};

console.log(`backend : ${URL_}\n`);

// ---- 1) what PostgREST exposes to the anon role -----------------------------
// The OpenAPI document only lists RPCs that exist AND are executable by anon,
// and only the HTTP verbs anon holds table privileges for.
const specRes = await fetch(`${URL_}/rest/v1/`, { headers });
const spec = await specRes.json().catch(() => ({}));
const paths = Object.keys(spec.paths ?? {});
const wanted = ['/registrations', '/rpc/register_student', '/rpc/list_registrations', '/rpc/set_password',
  '/rpc/password_status', '/rpc/registration_by_phone', '/rpc/submit_feedback', '/rpc/list_feedback',
  '/rpc/verify_developer_code'];
console.log('--- OpenAPI (anon) ---');
for (const p of wanted) {
  const verbs = spec.paths?.[p] ? Object.keys(spec.paths[p]).filter((k) => k !== 'parameters') : null;
  console.log(`${p.padEnd(34)}${verbs ? verbs.join(',').toUpperCase() : 'NOT EXPOSED'}`);
}
const regParams = spec.paths?.['/rpc/register_student']?.post?.parameters?.map((p) => p.name).join(', ');
const setParams = spec.paths?.['/rpc/set_password']?.post?.parameters?.map((p) => p.name).join(', ');
console.log(`\nregister_student args : ${regParams ?? '(n/a)'}`);
console.log(`set_password args     : ${setParams ?? '(n/a)'}`);
console.log(`total exposed paths   : ${paths.length}\n`);

// ---- 2) the registration path (invalid args → guard rejects, no write) ------
console.log('--- registration path ---');
const reg = await post(`${URL_}/rest/v1/rpc/register_student`, { p_name: '', p_phone: '', p_department: null });
line('rpc/register_student (empty → 400 22023)', reg.status, reg.body);

const regNull = await post(`${URL_}/rest/v1/rpc/register_student`, { p_name: null, p_phone: null });
line('rpc/register_student (null, dept omitted)', regNull.status, regNull.body);

const pwdStatus = await post(`${URL_}/rest/v1/rpc/password_status`, { p_phone: '700000000' });
line('rpc/password_status', pwdStatus.status, pwdStatus.body);

const legacyInsert = await post(`${URL_}/rest/v1/registrations`, { name: '__diag__', phone: '' });
line('rest/registrations INSERT (legacy path)', legacyInsert.status, legacyInsert.body);

// ---- 3) the developer path (no grant token is held by this script) ----------
// With the token header ABSENT, RLS policies deny rows silently (204 / 0 rows).
// A 401 + 42501 instead means the TABLE privilege itself is missing — that is
// what breaks approve/delete in the app.
console.log('\n--- developer path (no x-dev-token) ---');
const patch = await verb('PATCH', `${URL_}/rest/v1/registrations?id=eq.${ZERO}`, { is_approved: true },
  { Prefer: 'return=minimal' });
line('rest/registrations PATCH is_approved', patch.status, patch.body);

const del = await verb('DELETE', `${URL_}/rest/v1/registrations?id=eq.${ZERO}`, null, { Prefer: 'return=minimal' });
line('rest/registrations DELETE', del.status, del.body);

const listReg = await post(`${URL_}/rest/v1/rpc/list_registrations`, {});
line('rpc/list_registrations (no token)', listReg.status, listReg.body);

const listRegBad = await post(`${URL_}/rest/v1/rpc/list_registrations`, {},
  { 'x-dev-token': '9999999999.deadbeef' });
line('rpc/list_registrations (forged token)', listRegBad.status, listRegBad.body);

const listFb = await post(`${URL_}/rest/v1/rpc/list_feedback`, {});
line('rpc/list_feedback (no token)', listFb.status, listFb.body);
