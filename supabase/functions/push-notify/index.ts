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

// ---------- Web Push (RFC 8291 / RFC 8188 — aes128gcm) ----------
const WEBPUSH_VAPID_PUBLIC_KEY = 'BAgNlZmy2X85JwCi85A1RxAU7i2Th9uGWCm0oHr-4OeOHDFyWXDVrDU6X7yrKc5ds-H0xzmgovSddjVYswjsqLg';
const WEBPUSH_SUBJECT = 'mailto:webpush@mohanndes.app';

function wpB64urlEnc(buf: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function wpB64urlDec(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hkdfExpand(ikmKey: CryptoKey, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikmKey, length);
  return new Uint8Array(bits);
}

async function buildVapidJwt(audience: string, vapidPrivateKeyPkcs8B64: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = { aud: audience, exp: now + 43200, sub: WEBPUSH_SUBJECT };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const padded = vapidPrivateKeyPkcs8B64.match(/.{1,64}/g)!.join('\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${padded}\n-----END PRIVATE KEY-----`;
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

async function encryptWebPushPayload(
  clientKeyB64: string,
  authB64: string,
  plaintext: string,
): Promise<{ encrypted: Uint8Array; salt: Uint8Array; serverPublicKeyRaw: Uint8Array }> {
  const clientKeyRaw = wpB64urlDec(clientKeyB64);
  const auth = wpB64urlDec(authB64);
  const clientPublicKey = await crypto.subtle.importKey('raw', clientKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));
  const sharedSecretKey = await crypto.subtle.deriveKey({ name: 'ECDH', public: clientPublicKey }, serverKeyPair.privateKey, { name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt']);
  const sharedSecret = new Uint8Array(await crypto.subtle.exportKey('raw', sharedSecretKey));
  const ikm = new Uint8Array(sharedSecret.length + auth.length);
  ikm.set(sharedSecret);
  ikm.set(auth, sharedSecret.length);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, []);
  const context = new Uint8Array(clientKeyRaw.length + serverPublicKeyRaw.length);
  context.set(clientKeyRaw);
  context.set(serverPublicKeyRaw, clientKeyRaw.length);
  const infoPrefix = new TextEncoder().encode('Content-Encoding: aes128gcm');
  const cekInfo = new Uint8Array(infoPrefix.length + context.length + 2);
  cekInfo.set(infoPrefix);
  cekInfo.set(context, infoPrefix.length);
  cekInfo.set([0x00, 0x10], infoPrefix.length + context.length);
  const cekBits = await hkdfExpand(ikmKey, salt, cekInfo, 128);
  const cekKey = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  const nonceInfo = new Uint8Array(infoPrefix.length + context.length + 2);
  nonceInfo.set(infoPrefix);
  nonceInfo.set(context, infoPrefix.length);
  nonceInfo.set([0x00, 0x0C], infoPrefix.length + context.length);
  const nonce = await hkdfExpand(ikmKey, salt, nonceInfo, 96);
  const data = new TextEncoder().encode(plaintext);
  const pt = new Uint8Array(data.length + 1);
  pt.set(data);
  pt[data.length] = 0x02;
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(0) }, cekKey, pt);
  return { encrypted: new Uint8Array(encrypted), salt, serverPublicKeyRaw };
}

async function sendWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: string,
  vapidPrivateKeyPkcs8B64: string,
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  try {
    const { encrypted, salt, serverPublicKeyRaw } = await encryptWebPushPayload(p256dh, auth, payload);
    const aud = new URL(endpoint).origin;
    const jwt = await buildVapidJwt(aud, vapidPrivateKeyPkcs8B64);
    const res = await fetch(endpoint, {
      method: 'POST',
      body: encrypted,
      headers: {
        'Encryption': `salt=${wpB64urlEnc(salt)}`,
        'Crypto-Key': `p256dh=${wpB64urlEnc(serverPublicKeyRaw)}`,
        'Content-Encoding': 'aes128gcm',
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
    });
    return { ok: res.status === 201, status: res.status, gone: res.status === 410 || res.status === 404 || res.status === 403 };
  } catch (e) {
    console.error(`[webpush] send error: ${String(e)}`);
    return { ok: false, status: 0, gone: false };
  }
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

  const vapidPrivateKeyPkcs8B64 = Deno.env.get('WEBPUSH_VAPID_PRIVATE_KEY');
  if (!vapidPrivateKeyPkcs8B64) {
    console.warn('[push-notify] WEBPUSH_VAPID_PRIVATE_KEY not set — Web Push will be skipped');
  }

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
  // Also query Web Push subscriptions (PWA / browser installs).
  // Same department / alerts filtering as FCM tokens.
  let webSubs: { endpoint: string; p256dh: string; auth: string; department: string | null; alerts_enabled: boolean; is_developer: boolean }[] = [];
  if (vapidPrivateKeyPkcs8B64) {
    let wquery = supabase
      .from('web_push_subscriptions')
      .select('endpoint, p256dh, auth, department, alerts_enabled, is_developer')
      .eq('alerts_enabled', true);
    if (sourceTable === 'registrations') {
      wquery = wquery.eq('is_developer', true);
    }
    if (sourceTable !== 'registrations' && dept && dept !== 'مشترك') {
      wquery = wquery.or(`department.eq.${dept},department.is.null`);
    }
    const { data: wdata, error: werror } = await wquery;
    if (werror) {
      console.warn('[push-notify] web_push_subscriptions query failed', werror);
    } else {
      webSubs = (wdata ?? []).map((r: any) => ({
        endpoint: r.endpoint,
        p256dh: r.p256dh,
        auth: r.auth,
        department: r.department,
        alerts_enabled: r.alerts_enabled,
        is_developer: r.is_developer,
      }));
    }
  }

  if ((!tokens || tokens.length === 0) && (!webSubs || webSubs.length === 0)) {
    return new Response(JSON.stringify({ ok: true, sent: 0, failed: 0, removed: 0, webSent: 0, webFailed: 0, webRemoved: 0 }), { status: 200 });
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

  // ---------- Web Push sending (PWA / browser installs) ----------
  let webSent = 0;
  let webFailed = 0;
  const deadWebSubs: string[] = [];

  if (vapidPrivateKeyPkcs8B64 && webSubs.length > 0) {
    for (const sub of webSubs) {
      const res = await sendWebPush(sub.endpoint, sub.p256dh, sub.auth, JSON.stringify({
        title: content.title,
        body: content.body,
        tab: content.tab,
        urgent: content.urgent,
      }), vapidPrivateKeyPkcs8B64);
      if (res.ok) {
        webSent += 1;
      } else {
        webFailed += 1;
        if (res.gone) deadWebSubs.push(sub.endpoint);
      }
    }
  }

  // Prune web push subscriptions the push service reports as gone.
  for (const dead of deadWebSubs) {
    await supabase.from('web_push_subscriptions').delete().eq('endpoint', dead);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      sent,
      failed,
      removed: deadTokens.length,
      webSent,
      webFailed,
      webRemoved: deadWebSubs.length,
      title: content.title,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
