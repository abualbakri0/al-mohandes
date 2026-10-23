// Print the EXACT failure body for the developer's approve/delete path, so we
// can tell "missing GRANT" (permission denied for table) apart from
// "RLS blocked" (new row violates row-level security policy) and from a silent
// 0-row update (204 No Content → no error, nothing changed).
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const U = env.VITE_SUPABASE_URL;
const K = env.VITE_SUPABASE_ANON_KEY;
const ZERO = '00000000-0000-0000-0000-000000000000';
const base = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

async function probe(label, method, path, body, headers = {}) {
  const r = await fetch(`${U}/rest/v1/${path}`, {
    method,
    headers: { ...base, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  console.log(`\n${label}  →  ${r.status}`);
  console.log('  body:', text.slice(0, 400) || '(empty)');
  return { status: r.status, text };
}

// developer's approve (PATCH) and delete (DELETE) with no dev token
await probe('PATCH  registrations (approve, no token)', 'PATCH', `registrations?id=eq.${ZERO}`, { is_approved: true }, { Prefer: 'return=minimal' });
await probe('DELETE registrations (no token)', 'DELETE', `registrations?id=eq.${ZERO}`, null, { Prefer: 'return=minimal' });

// same two calls WITH a deliberately bogus token → isolates "policy exists but
// rejects the token" from "no write policy at all"
const bogus = { 'x-dev-token': 'bogus.token.value' };
await probe('PATCH  registrations (bogus token)', 'PATCH', `registrations?id=eq.${ZERO}`, { is_approved: true }, { ...bogus, Prefer: 'return=minimal' });
await probe('DELETE registrations (bogus token)', 'DELETE', `registrations?id=eq.${ZERO}`, null, { ...bogus, Prefer: 'return=minimal' });

// which RPCs exist right now?
for (const fn of ['list_registrations', 'verify_developer_code', 'dev_token_ok', 'approve_registration', 'delete_registration']) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: base, body: '{}' });
  const t = await r.text();
  console.log(`\nrpc ${fn.padEnd(24)} → ${r.status}  ${t.slice(0, 200).replace(/\s+/g, ' ')}`);
}
