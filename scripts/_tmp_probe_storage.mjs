import { readFileSync } from 'node:fs';

// Temporary probe: verify references bucket restrictions (Section 9 of
// RUN-THIS-IN-SUPABASE.sql) using the exact production client (supabase-js).
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

// 1) Non-PDF probe — MUST be rejected if allowed_mime_types is enforced.
const t1 = await supabase.storage
  .from('references')
  .upload('__probe__.txt', new Blob(['probe'], { type: 'text/plain' }), {
    contentType: 'text/plain',
  });
console.log(
  'TXT upload (expect REJECTED):',
  t1.error ? `REJECTED -> ${t1.error.message}` : `ACCEPTED -> ${t1.data?.path}`
);

// 2) PDF probe — MUST still be accepted (normal dev upload flow).
const t2 = await supabase.storage
  .from('references')
  .upload('__probe__.pdf', new Blob(['%PDF-1.4 probe'], { type: 'application/pdf' }), {
    contentType: 'application/pdf',
  });
console.log(
  'PDF upload (expect ACCEPTED):',
  t2.error ? `ERROR -> ${t2.error.message}` : `ACCEPTED -> ${t2.data?.path}`
);

// Cleanup anything that was actually created.
for (const [label, res] of [
  ['txt', t1],
  ['pdf', t2],
]) {
  if (!res.error) {
    const rm = await supabase.storage.from('references').remove([res.data.path]);
    console.log(
      `cleanup ${label}:`,
      rm.error ? `ERROR -> ${rm.error.message}` : 'removed ok'
    );
  }
}
