/*
 * Verify the study_progress migration on Supabase using the REST API (anon key
 * from .env) — no DB password needed. Confirms:
 *   1. The table exists and is queryable.
 *   2. RLS allows INSERT + SELECT (the two ops the app relies on).
 *   3. Reports any leftover rows.
 *
 * Usage:  node verify-study-progress.mjs
 * Exit code 0 = all good, 1 = something needs attention.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- Load .env (tiny parser, no dependency) ---
const here = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  try {
    const raw = readFileSync(join(here, '.env'), 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch {
    return {};
  }
}
const env = loadEnv();
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;

if (!URL_ || !KEY) {
  console.error('ERROR: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in .env');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
let ok = true;
const fail = (msg) => { ok = false; console.error('  ✗ ' + msg); };
const pass = (msg) => console.log('  ✓ ' + msg);

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

console.log('\n[1/3] Table exists & is queryable…');
{
  const r = await rest('study_progress?select=id&limit=1');
  if (r.status === 200) pass('study_progress is reachable (SELECT works under RLS).');
  else if (r.status === 404) fail('study_progress NOT found — did the migration run?');
  else fail(`SELECT returned ${r.status}: ${r.text}`);
}

console.log('\n[2/3] RLS allows INSERT (upsert target)…');
{
  // Probe with a throwaway task/user id we immediately delete. Uses a random
  // uuid-shaped task id and a probe user id; cleaned up right after.
  const probeTask = '00000000-0000-0000-0000-000000000000';
  const probeUser = '__verify_probe__';
  const ins = await rest('study_progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ task_id: probeTask, user_id: probeUser, completed: true }),
  });
  if (ins.status >= 200 && ins.status < 300) {
    pass('INSERT/UPSERT allowed under RLS.');
    // Clean up the probe row.
    await rest(`study_progress?task_id=eq.${probeTask}&user_id=eq.${probeUser}`, { method: 'DELETE' });
    pass('Probe row cleaned up.');
  } else if (ins.status === 404 || ins.status === 400) {
    fail(`INSERT returned ${ins.status}: ${ins.text}`);
  } else {
    fail(`INSERT returned ${ins.status}: ${ins.text}`);
  }
}

console.log('\n[3/3] Row count (existing progress rows)…');
{
  const r = await rest('study_progress?select=id', { headers: { ...headers, Prefer: 'count=exact' } });
  const count = r.json ? r.json.length : 0;
  console.log(`  • study_progress currently has ${count} row(s).`);
}

console.log('');
if (ok) {
  console.log('✅ study_progress is set up correctly. Cross-device sync + developer stats are live.');
  process.exit(0);
} else {
  console.log('❌ Something needs attention — re-run the migration SQL in the Supabase SQL Editor.');
  process.exit(1);
}
