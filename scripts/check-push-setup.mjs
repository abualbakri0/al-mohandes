// One-off diagnostic: checks push_tokens table + push-notify edge function.
// Reads .env manually (no dotenv dependency).
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

// 1) push_tokens table
const t = await fetch(`${URL_}/rest/v1/push_tokens?select=token,department,alerts_enabled&limit=5`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
});
const tBody = await t.text();
if (t.status === 200) {
  console.log('push_tokens: OK —', tBody === '[]' ? 'EMPTY (no device registered yet)' : tBody.slice(0, 400));
} else {
  console.log(`push_tokens: FAILED (${t.status}) —`, tBody.slice(0, 300));
}

// 2) push-notify function reachable?
const f = await fetch(`${URL_}/functions/v1/push-notify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ title: 'اختبار', body: 'رسالة تجريبية' }),
});
const fBody = await f.text();
console.log(`push-notify: HTTP ${f.status} —`, fBody.slice(0, 400));
