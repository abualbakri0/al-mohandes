// Diagnostic (read-only): reproduces the browser login step by step and checks
// whether the DEPLOYED web bundle is older than the local one.
//
// Why this exists: the lock-down migrations revoked SELECT on `registrations`
// from anon. A web bundle built *before* that change still reads the table
// directly, so the login screen shows the generic
// "تعذّر التحقق. تأكد من اتصال الإنترنت" message while the network is fine.
//
// Usage: node scripts/diagnose-login.mjs [phone] [webUrl]
//   phone  — a real registered number (default 779809243)
//   webUrl — the deployed site (default: VITE_IOS_URL from .env)
//
// Nothing is written; no passwords are printed.
import { readFileSync, existsSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const phone = process.argv[2] ?? '779809243';
const webUrl = (process.argv[3] ?? env.VITE_IOS_URL ?? '').replace(/\/$/, '');

if (!URL_ || !ANON) {
  console.log('MISSING_ENV');
  process.exit(1);
}

const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const short = (s) => (s.length > 150 ? s.slice(0, 150) + '…' : s);
const line = (label, status, body) => console.log(`${String(status).padEnd(4)}${label.padEnd(42)}${short(body)}`);

async function rpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  return { status: r.status, body: await r.text() };
}

console.log(`backend : ${URL_}`);
console.log(`phone   : ${phone}\n`);

// ---- 1) the five calls the login screen makes -------------------------------
const reg = await rpc('registration_by_phone', { p_phone: phone });
line('rpc/registration_by_phone  (new bundle)', reg.status, reg.body);

const direct = await fetch(`${URL_}/rest/v1/registrations?select=*&phone=eq.${encodeURIComponent(phone)}`, { headers });
line('rest/registrations         (old bundle)', direct.status, await direct.text());

const pwd = await rpc('password_status', { p_phone: phone });
line('rpc/password_status', pwd.status, pwd.body);

// Deliberately wrong password: a working RPC answers 200 false.
const ver = await rpc('verify_password', { p_phone: phone, p_password: '__diagnostic__' });
line('rpc/verify_password (wrong pw → 200 false)', ver.status, ver.body);

const ses = await rpc('progress_session_open', { p_phone: phone, p_password: '__diagnostic__' });
line('rpc/progress_session_open (→ bad_password)', ses.status, ses.body);

console.log('');

// ---- 2) is the deployed bundle the fixed one? ------------------------------
if (webUrl) {
  try {
    const html = await (await fetch(`${webUrl}/`, { headers: { 'Cache-Control': 'no-cache' } })).text();
    const served = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? '(none)';
    const local = existsSync('dist/index.html')
      ? (readFileSync('dist/index.html', 'utf8').match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? '(none)')
      : '(dist missing)';

    const js = await (await fetch(`${webUrl}/${served}`)).text();
    const hasNewRpc = js.includes('registration_by_phone');
    const hasNewUnregister = js.includes('unregister_push_token');

    console.log(`web     : ${webUrl}`);
    console.log(`served  : ${served}  (${js.length} chars)`);
    console.log(`local   : ${local}`);
    console.log(`served bundle uses rpc/registration_by_phone : ${hasNewRpc ? 'YES' : 'NO  ← stale deployment'}`);
    console.log(`served bundle has unregister_push_token      : ${hasNewUnregister ? 'YES' : 'NO  ← stale deployment'}`);
    console.log('');
  } catch (e) {
    console.log(`web     : could not fetch ${webUrl} (${e?.message}) — skipped\n`);
  }
}

// ---- 3) verdict ------------------------------------------------------------
const backendOk = reg.status === 200 && pwd.status === 200 && ver.status === 200;
const lockdownOn = direct.status === 401 || direct.status === 403;

console.log('verdict');
console.log(`  backend ready for the new bundle ......... ${backendOk ? 'YES' : 'NO'}`);
console.log(`  direct registrations read is blocked ..... ${lockdownOn ? 'YES (expected)' : 'NO — lockdown not applied'}`);
if (backendOk && lockdownOn) {
  console.log(
    '  ⇒ a bundle that still reads registrations directly fails here with 42501.\n' +
      '    If the browser shows "تعذّر التحقق", redeploy dist and reload — see the served/local bundle above.',
  );
}
