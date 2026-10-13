// Diagnostic: verify that Supabase Realtime (postgres_changes) actually delivers
// events for the `notifications` table to an anon-key client — exactly like the app.
//
// Zero visible side effects: it performs an UPDATE that writes the same title back
// (no value change), then reports whether the realtime event arrived.
//
// Usage: node scripts/verify-realtime.mjs

// Diagnostic: verify that Supabase Realtime (postgres_changes) actually delivers
// events to an anon-key client — exactly like the app.
//
// 1) `notifications` is empty in production, so it INSERTs a clearly-marked test row
//    (department "اختبار-تقني" so no real student department matches) and deletes it
//    right after the event is received / timed out.
// 2) Other watched tables get a no-op UPDATE (same values written back → invisible).
//
// Usage: node scripts/verify-realtime.mjs

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function readEnv() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnv();
const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('ERROR: .env missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}

const supabase = createClient(url, anon);

// table → column used for the invisible no-op UPDATE
const NOOP_TABLES = {
  lectures: 'subject',
  assignments: 'title',
  exams: 'subject',
  reference_materials: 'title',
};

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function subscribeTo(table, filter) {
  const state = { received: null, subscribed: false };
  const channel = supabase
    .channel(`verify-${table}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
      (payload) => { state.received = payload; },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') state.subscribed = true;
    });
  const t0 = Date.now();
  while (!state.subscribed && Date.now() - t0 < 8000) await wait(150);
  state.channel = channel;
  return state;
}

async function main() {
  let failures = 0;

  // ---------- 1) notifications: INSERT + DELETE test ----------
  {
    const sub = await subscribeTo('notifications');
    if (!sub.subscribed) {
      console.log('notifications: SUBSCRIBE_FAILED');
      failures++;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('notifications')
        .insert({
          title: '🔧 فحص تقني — يُحذف تلقائياً',
          message: 'تجربة سلسلة الإشعارات من سكربت verify-realtime',
          notification_type: 'general',
          department: 'اختبار-تقني',
        })
        .select('id')
        .single();

      if (insErr) {
        console.log('notifications: INSERT_FAILED:', insErr.message);
        failures++;
      } else {
        const t0 = Date.now();
        while (!sub.received && Date.now() - t0 < 12000) await wait(150);
        // Always clean up.
        await supabase.from('notifications').delete().eq('id', inserted.id);
        if (sub.received) {
          console.log(`notifications: REALTIME_OK (event after ${Date.now() - t0}ms) — test row deleted.`);
        } else {
          console.log('notifications: REALTIME_SILENT — INSERT event did NOT arrive within 12s.');
          failures++;
        }
      }
      await supabase.removeChannel(sub.channel);
    }
  }

  // ---------- 2) other watched tables: invisible no-op UPDATE ----------
  for (const [table, col] of Object.entries(NOOP_TABLES)) {
    const { data: rows, error: readErr } = await supabase.from(table).select('id, ' + col).limit(1);
    if (readErr) {
      console.log(`${table}: READ_FAILED: ${readErr.message}`);
      failures++;
      continue;
    }
    if (!rows || rows.length === 0) {
      console.log(`${table}: SKIP (empty table)`);
      continue;
    }
    const row = rows[0];
    const sub = await subscribeTo(table, `id=eq.${row.id}`);
    if (!sub.subscribed) {
      console.log(`${table}: SUBSCRIBE_FAILED`);
      failures++;
      await supabase.removeChannel(sub.channel);
      continue;
    }
    const { error: updErr } = await supabase.from(table).update({ [col]: row[col] }).eq('id', row.id);
    if (updErr) {
      console.log(`${table}: UPDATE_FAILED: ${updErr.message}`);
      failures++;
    } else {
      const t0 = Date.now();
      while (!sub.received && Date.now() - t0 < 8000) await wait(150);
      console.log(
        sub.received
          ? `${table}: REALTIME_OK`
          : `${table}: REALTIME_SILENT — UPDATE event did NOT arrive within 8s.`,
      );
      if (!sub.received) failures++;
    }
    await supabase.removeChannel(sub.channel);
  }

  console.log(failures === 0 ? 'SUMMARY: ALL_OK' : `SUMMARY: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e);
  process.exit(2);
});
