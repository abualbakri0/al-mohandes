// Diagnostic #2 (WRITES one test row): reproduces a brand-new signup with a
// throw-away phone number so nothing real is touched.
//
// Test phone: 700000000 · name: DIAG TEST
// Cleanup SQL (run once in the SQL editor when you apply the fix):
//   DELETE FROM public.user_passwords WHERE phone = '700000000';
//   DELETE FROM public.registrations WHERE phone = '700000000' OR name = '__diag__';
//   DELETE FROM public.student_keys WHERE user_id IN (
//     SELECT id FROM public.registrations WHERE phone = '700000000');
//
// Usage: node scripts/diagnose-signup.mjs
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const PHONE = process.argv[2] ?? '700000000';
const PASS = 'diag-1234';

const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const short = (s) => (s.length > 240 ? s.slice(0, 240) + '…' : s);
const line = (label, status, body) => console.log(`${String(status).padEnd(4)}${label.padEnd(52)}${short(body)}`);

const rpc = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  return { status: r.status, body: await r.text() };
};

console.log(`backend: ${URL_}   test phone: ${PHONE}\n`);

// step 0 — is the phone already taken? (must be "no rows" for a clean test)
line('rpc/registration_by_phone', ...Object.values(await rpc('registration_by_phone', { p_phone: PHONE })));

// step 1 — register_student (the new bundle's first call)
const reg = await rpc('register_student', { p_name: 'DIAG TEST', p_phone: PHONE, p_department: 'كهرباء' });
line('rpc/register_student', reg.status, reg.body);

// step 2 — set_password (called right after; 4 args like the client)
const set = await rpc('set_password', { p_phone: PHONE, p_password: PASS, p_must_change: false, p_current: null });
line('rpc/set_password {4 args}', set.status, set.body);

// step 2b — same call with the 3-arg shape (older signature, for comparison)
const set3 = await rpc('set_password', { p_phone: PHONE, p_password: PASS, p_must_change: false });
line('rpc/set_password {3 args}', set3.status, set3.body);

// step 3 — password_status (what the login screen reads)
line('rpc/password_status', ...Object.values(await rpc('password_status', { p_phone: PHONE })));

// step 4 — verify_password (hash round-trip must be true)
line('rpc/verify_password (correct → true)', ...Object.values(await rpc('verify_password', { p_phone: PHONE, p_password: PASS })));

// step 5 — progress_session_open (client calls it right after signup)
line('rpc/progress_session_open', ...Object.values(await rpc('progress_session_open', { p_phone: PHONE, p_password: PASS })));

// step 6 — can the row be read back the way login will?
line('rpc/registration_by_phone (after insert)', ...Object.values(await rpc('registration_by_phone', { p_phone: PHONE })));
