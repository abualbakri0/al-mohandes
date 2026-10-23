// Diagnostic #3 (read-only): does the LEGACY write path fail *after* inserting?
// The old bundle does INSERT ... RETURNING (supabase .insert().select()), and
// RETURNING needs SELECT — which migration 20261023011000 revoked. PostgREST
// then answers 401 42501 although the row was already written: the student sees
// "حدث خطأ أثناء التسجيل" yet still appears in the developer's list.
//
// Uses the all-zero UUID / empty payload so nothing new is created:
//   • POST with Prefer: return=representation is allowed to insert, but we send
//     a body the table rejects (unknown column) → error happens in the parser,
//     before the INSERT. So this only measures the RETURNING privilege.
//
// Usage: node scripts/diagnose-legacy-insert.mjs
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const short = (s) => (s.length > 220 ? s.slice(0, 220) + '…' : s);
const line = (l, s, b) => console.log(`${String(s).padEnd(4)}${l.padEnd(54)}${short(b)}`);

// prefer=return=representation → INSERT ... RETURNING (old bundle).
// A privilege error aborts the whole statement, so no row is written when this
// answers 401 (measured: the plain INSERT alone answers 201).
const repr = await fetch(`${URL_}/rest/v1/registrations`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify({ name: '', phone: '' }),
});
line('INSERT prefer=representation (old bundle)', repr.status, await repr.text());

// ---- what the deployed site actually serves --------------------------------
const site = (process.argv[2] ?? 'https://al-mohandes-app-2026.vercel.app').replace(/\/$/, '');
const html = await fetch(site + '/', { headers: { 'cache-control': 'no-cache' } }).then((r) => r.text());
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log(`\n--- ${site} ---`);
console.log('index.html scripts :', scripts.join(' ') || '(none)');
for (const src of scripts) {
  const res = await fetch(site + src, { cache: 'no-store' });
  const js = await res.text();
  console.log(
    `${src}  ${res.status}  ${js.length} chars  ` +
      `register_student=${js.includes('register_student')} ` +
      `legacyInsert=${js.includes(".insert(")}`,
  );
}
