// One-off diagnostic: insert a test notification row (fires the DB webhook ->
// push-notify -> FCM) then delete it. REST-only, anon key from .env.
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const H = {
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
  'Content-Type': 'application/json',
};

const ins = await fetch(`${URL_}/rest/v1/notifications`, {
  method: 'POST',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({
    title: 'اختبار وصول الإشعارات',
    message: 'رسالة اختبار من المطور — يمكن تجاهلها وسيُحذف الإشعار تلقائيًا.',
    notification_type: 'general',
    department: null,
  }),
});
const insBody = await ins.text();
console.log('INSERT:', ins.status, insBody.slice(0, 400));

let id = null;
try { id = JSON.parse(insBody)?.[0]?.id; } catch { /* ignore */ }
if (!id) { console.log('NO ID — cannot clean up; DELETE MANUALLY if it appeared.'); process.exit(1); }

// Give the webhook a moment to fire, then delete the test row.
await new Promise((r) => setTimeout(r, 8000));
const del = await fetch(`${URL_}/rest/v1/notifications?id=eq.${id}`, {
  method: 'DELETE',
  headers: H,
});
console.log('DELETE:', del.status, (await del.text()).slice(0, 200));
console.log('DONE — check your phone tray (app closed) for «اختبار وصول الإشعارات».');
