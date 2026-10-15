// Supabase Edge Function: push-notify
// Sends FCM "display" messages so users get notifications even when the app
// is FULLY CLOSED (Realtime cannot do that — no JS alive to receive events).
//
// DEPLOY:
//   1) supabase functions deploy push-notify
//   2) Set secrets (Dashboard -> Edge Functions -> Secrets, or CLI):
//        FIREBASE_SERVICE_ACCOUNT = full JSON of a Firebase service-account key
//                                   (Firebase Console -> Project settings ->
//                                    Service accounts -> Generate new key)
//        WEBHOOK_SECRET           = optional shared secret sent as
//                                   Authorization: Bearer <secret>
//   3) Dashboard -> Database -> Webhooks -> trigger on INSERT of:
//        notifications, lectures, assignments, exams, reference_materials
//      Type = Supabase Edge Function, function = push-notify.
//      Include registrations only if developer devices need background alerts.
//        registrations (developer devices only; requires is_developer on push_tokens).
//      Feedback is intentionally not pushed while the app is closed.
//
// Manual test (curl):
//   curl -i -X POST "https://<PROJECT>.supabase.co/functions/v1/push-notify" \
//     -H "Content-Type: application/json" \
//     -H "Authorization: Bearer <WEBHOOK_SECRET>" \
//     -d '{"title":"اختبار","body":"رسالة تجريبية"}'
//
// Token targeting: push_tokens.department must match the row's department,
// or the row is a broadcast (department NULL or 'مشترك'). Devices that turned
// off "تنبيهات المحتوى" (alerts_enabled = false) are skipped.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type PushRecord = Record<string, string | number | boolean | null | undefined>;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

// ---------- OAuth2 (service account -> FCM v1) ----------

let cachedToken: { value: string; exp: number } | null = null;

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64url(input: string | Uint8Array): string {
  let bin: string;
  if (typeof input === 'string') {
    bin = btoa(input);
  } else {
    bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < input.length; i += chunk) {
      bin += String.fromCharCode(...input.subarray(i, i + chunk));
    }
    bin = btoa(bin);
  }
  return bin.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function fetchAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`oauth2 token failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const value = await fetchAccessToken(sa);
  cachedToken = { value, exp: Date.now() + 55 * 60 * 1000 };
  return value;
}

// ---------- Payload building (mirrors src/hooks/useOfficialRealtime.ts) ----------

function formatTime12(t: unknown): string {
  if (t === null || t === undefined) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
  if (!m) return String(t);
  const h = Number(m[1]);
  const mm = m[2];
  if (Number.isNaN(h)) return String(t);
  const period = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${period}`;
}

function buildContent(
  table: string,
  record: PushRecord,
): { title: string; body: string; tab: string; urgent: boolean } | null {
  switch (table) {
    case 'notifications': {
      const urgent = record.notification_type === 'postponement';
      return {
        title: `${urgent ? '🚨 ' : '🔔 '}${record.title ?? 'إشعار جديد'}`,
        body: String(record.message ?? ''),
        tab: 'notifications',
        urgent,
      };
    }
    case 'lectures': {
      const when = record.is_holiday
        ? ' (إجازة)'
        : ` — يوم ${record.day} الساعة ${formatTime12(record.start_time)}`;
      const teacher = record.teacher ? ` — م.${record.teacher}` : '';
      return { title: '📚 محاضرة جديدة', body: `${record.subject}${when}${teacher}`, tab: 'schedule', urgent: false };
    }
    case 'assignments':
      return {
        title: '📝 تكليف جديد',
        body: `${record.subject}: ${record.title} — التسليم ${record.due_date}`,
        tab: 'assignments',
        urgent: false,
      };
    case 'exams':
      return {
        title: '📋 اختبار جديد',
        body: `${record.subject} — يوم ${record.exam_date} الساعة ${formatTime12(record.start_time)}`,
        tab: 'exams',
        urgent: false,
      };
    case 'reference_materials':
      return { title: '📖 مرجع جديد', body: String(record.title ?? ''), tab: 'references', urgent: false };
    case 'registrations':
      return {
        title: '👤 مسجل جديد',
        body: `${String(record.name ?? 'مستخدم جديد')} — ${String(record.phone ?? '')}`,
        tab: 'registrations',
        urgent: false,
      };
    default:
      return null;
  }
}

function isUnregistered(text: string): boolean {
  return text.includes('UNREGISTERED') || text.includes('registration-token-not-registered');
}

// ---------- HTTP handler ----------

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Optional shared-secret check (Supabase DB Webhooks can send it as a header).
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (webhookSecret) {
    const raw = req.headers.get('authorization') ?? req.headers.get('x-webhook-secret') ?? '';
    const bearer = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (bearer !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
  }

  let body: {
    type?: string;
    table?: string;
    record?: PushRecord;
    title?: string;
    body?: string;
    department?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const serviceAccountRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  if (!supabaseUrl || !serviceKey || !serviceAccountRaw) {
    return new Response(
      JSON.stringify({ error: 'missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / FIREBASE_SERVICE_ACCOUNT' }),
      { status: 500 },
    );
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountRaw);
  } catch {
    return new Response(JSON.stringify({ error: 'FIREBASE_SERVICE_ACCOUNT is not valid JSON' }), { status: 500 });
  }
  if (!serviceAccount.private_key || !serviceAccount.client_email || !serviceAccount.project_id) {
    return new Response(
      JSON.stringify({
        error:
          'FIREBASE_SERVICE_ACCOUNT missing private_key/client_email/project_id — ' +
          'it must be the SERVICE ACCOUNT key JSON (Firebase → Project settings → Service accounts → Generate new private key), ' +
          'NOT google-services.json',
        has: Object.keys(serviceAccount).join(','),
      }),
      { status: 500 },
    );
  }
  // Defensive: some secret stores turn real newlines into literal \n.
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

  // Content source 1: Database Webhook (INSERT event)
  let content: { title: string; body: string; tab: string; urgent: boolean } | null = null;
  let dept: string | null = null;
  let sourceTable = 'notifications';
  let recordId = '';

  if (body.record && body.table) {
    if (body.type && body.type !== 'INSERT') {
      return new Response(JSON.stringify({ skipped: true, reason: `ignored event ${body.type}` }), { status: 200 });
    }
    content = buildContent(body.table, body.record);
    if (!content) {
      return new Response(JSON.stringify({ skipped: true, reason: `table ${body.table} not pushed` }), { status: 200 });
    }
    sourceTable = body.table;
    recordId = String(body.record.id ?? '');
    dept = (body.record.department as string | null | undefined) ?? null;
  } else if (body.title) {
    // Content source 2: manual curl (for smoke tests)
    content = { title: body.title, body: body.body ?? '', tab: 'notifications', urgent: false };
    dept = body.department ?? null;
  } else {
    return new Response(JSON.stringify({ skipped: true, reason: 'no record or title in payload' }), { status: 200 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let query = supabase.from('push_tokens').select('token, department').eq('alerts_enabled', true);
  if (sourceTable === 'registrations') {
    query = query.eq('is_developer', true);
  }
  if (sourceTable !== 'registrations' && dept && dept !== 'مشترك') {
    // Dept-scoped broadcast ALSO reaches devices whose department is still
    // unknown (NULL — freshly installed, user not registered yet), matching
    // the foreground behaviour in matchesDept() (null userDept => match all).
    query = query.or(`department.eq.${dept},department.is.null`);
  }
  const { data: tokens, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, failed: 0, removed: 0 }), { status: 200 });
  }

  let token: string;
  try {
    token = await accessToken(serviceAccount);
  } catch (e) {
    return new Response(JSON.stringify({ error: `oauth2: ${String(e)}` }), { status: 500 });
  }

  // Accent color per importance (matches the in-app glass palettes):
  // updates = teal #0D9488, alerts (urgent) = red #EF4444.
  const notifyColor = content.urgent ? '#EF4444' : '#0D9488';
  const channelId = content.urgent ? 'mohanndes_alerts' : 'mohanndes_updates';
  const data = {
    table: sourceTable,
    id: recordId,
    tab: content.tab,
    urgent: String(content.urgent),
  };

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];

  for (const row of tokens) {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: row.token as string,
            notification: { title: content.title, body: content.body },
            data,
            android: {
              priority: 'high',
              notification: {
                channel_id: channelId,
                // Tints the small icon + app name so the tray matches app brand.
                color: notifyColor,
                default_vibrate_timings: true,
                default_sound: true,
                visibility: 1,
              },
            },
          },
        }),
      },
    );
    if (res.ok) {
      sent += 1;
    } else {
      failed += 1;
      const text = await res.text();
      console.error(`[push-notify] send failed: ${res.status} ${text}`);
      if (isUnregistered(text)) deadTokens.push(row.token as string);
    }
  }

  // Prune tokens FCM reports as gone so retries stay fast.
  for (const dead of deadTokens) {
    await supabase.from('push_tokens').delete().eq('token', dead);
  }

  return new Response(
    JSON.stringify({ ok: true, sent, failed, removed: deadTokens.length, title: content.title }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
