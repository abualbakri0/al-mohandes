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
  evt: 'INSERT' | 'UPDATE' = 'INSERT',
): { title: string; body: string; tab: string; urgent: boolean } | null {
  // Edit popups mirror the foreground Realtime wording (src/hooks/useOfficialRealtime.ts).
  const EDIT_TITLES: Record<string, string> = {
    notifications: '✏️ تعديل إشعار',
    lectures: '✏️ تعديل محاضرة',
    assignments: '✏️ تعديل تكليف',
    exams: '✏️ تعديل اختبار',
    reference_materials: '✏️ تعديل مرجع',
  };
  const base = buildContentFor(table, record);
  if (!base) return null;
  if (evt === 'UPDATE') {
    // Match the Realtime UPDATE wording exactly so foreground dedup
    // (markSeen) is the only thing deciding which copy shows.
    if (table === 'notifications') {
      const urgent = record.notification_type === 'postponement';
      return {
        ...base,
        title: `${urgent ? '🚨 ' : '🔕 '}${String(record.title ?? 'إشعار')}`,
        body: `تم تعديل الإشعار — ${base.body}`,
      };
    }
    return { ...base, title: EDIT_TITLES[table] ?? `✏️ ${base.title}` };
  }
  return base;
}

function buildContentFor(
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

// Mirrors isMeaningfulUpdate() in src/hooks/useOfficialRealtime.ts: only
// alert on an UPDATE if a content field actually moved (ignores no-op saves
// and per-user progress columns like `completed`).
const CONTENT_FIELDS: Record<string, string[]> = {
  lectures: ['subject', 'day', 'start_time', 'end_time', 'location', 'department', 'is_holiday', 'teacher'],
  assignments: ['subject', 'title', 'request_date', 'due_date', 'department'],
  exams: ['subject', 'exam_date', 'start_time', 'end_time', 'location', 'department', 'teacher'],
  notifications: ['title', 'message', 'notification_type', 'department'],
  reference_materials: ['title', 'description', 'department'],
};

function isMeaningfulUpdate(table: string, oldRow: PushRecord, newRow: PushRecord): boolean {
  const fields = CONTENT_FIELDS[table];
  if (!fields) return true;
  const oldKeys = Object.keys(oldRow ?? {});
  if (oldKeys.length <= 1) return true; // old row carries just the id → can't diff
  return fields.some((f) => oldRow[f] !== newRow[f]);
}

function isUnregistered(text: string): boolean {
  // UNREGISTERED / NOT_FOUND = التطبيق حُذف أو التوكن أُبطل.
  // INVALID_ARGUMENT "not a valid FCM registration token" = توكن تالف/من مشروع
  // آخر — لا يمكن أن ينجح أبداً، لذا يُعدّ ميتاً أيضاً حتى لا يبقى للأبد.
  return (
    text.includes('UNREGISTERED') ||
    text.includes('registration-token-not-registered') ||
    text.includes('NOT_FOUND') ||
    text.includes('not a valid FCM registration token') ||
    text.includes('SENDER_ID_MISMATCH')
  );
}

// ---------- Web Push (RFC 8291 / RFC 8188 — aes128gcm) ----------
//
// لماذا كانت إشعارات الويب لا تصل (أسباب مؤكدة):
//  1) ترخيص VAPID كان يُرسل كـ "Authorization: Bearer <jwt>" وهذا خطأ:
//     خدمات Push تتطلب  Authorization: vapid t=<jwt>, k=<publicKey>
//     ⇒ كل محاولة كانت ترجع 401/403.
//  2) الحمولة كانت تُشفّر ببنية draft-04 القديمة (ترويسات Encryption /
//     Crypto-Key) بينما Content-Encoding معلن aes128gcm ⇒ يجب أن يحمل
//     الجسم نفسه الترويسة: salt(16) || rs(4) || idlen(1) || serverPub(65).
//  3) الاشتراكات كانت تُحذف عند 403 رغم أنها سليمة (403 = مفتاح VAPID خطأ).
const WEBPUSH_VAPID_PUBLIC_KEY =
  'BAVbmfT7ueuA7jIEhBCuBLrmqHARowQiSTtM6Y9b6DHOi0gts71gpaGpu7udDKhNa1nMJQwjT9BqdzPeAnyKsN4';
const WEBPUSH_SUBJECT = 'mailto:webpush@mohanndes.app';
const WEBPUSH_RECORD_SIZE = 4096;
const textEncoder = new TextEncoder();

function wpB64urlEnc(buf: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function wpB64urlDec(str: string): Uint8Array {
  const normalized = String(str).trim().replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(normalized + padding);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function wpConcat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** HKDF-SHA256 (RFC 5869) عبر WebCrypto. */
async function wpHkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/**
 * يحمّل مفتاح VAPID الخاص بأي صيغة محتملة في الأسرار:
 *  - PEM كامل -----BEGIN PRIVATE KEY-----
 *  - PKCS8 base64 (ناتج scripts/gen-vapid-keys.mjs → VAPID_PRIVATE_KEY_PKCS8_B64)
 *  - القيمة الخام d بصيغة base64url (JWK → VAPID_PRIVATE_KEY_JWK_D)
 */
async function loadVapidPrivateKey(rawSecret: string): Promise<CryptoKey> {
  const cleaned = String(rawSecret).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  if (cleaned.includes('BEGIN PRIVATE KEY')) {
    return crypto.subtle.importKey('pkcs8', pemToDer(cleaned), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }

  const compact = cleaned.replace(/\s+/g, '');
  if (compact.length >= 100) {
    // PKCS8 مُرمّز base64 قياسي (قد يحتوي + و / و =)
    const der = wpB64urlDec(compact);
    return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }

  // مفتاح خام (d فقط) — نعيد بناء JWK من المفتاح العام المعلن
  const pub = wpB64urlDec(WEBPUSH_VAPID_PUBLIC_KEY);
  if (pub.length !== 65) throw new Error('WEBPUSH_VAPID_PUBLIC_KEY غير صالح');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: compact,
    x: wpB64urlEnc(pub.subarray(1, 33)),
    y: wpB64urlEnc(pub.subarray(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildVapidJwt(audience: string, key: CryptoKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = { aud: audience, exp: now + 43200, sub: WEBPUSH_SUBJECT };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, textEncoder.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

/**
 * فحص ذاتي: هل المفتاح الخاص في الأسرار يطابق فعلاً المفتاح العام المعلن؟
 * خدمات Push ترفض التوقيع (401/403 invalid JWT) عندما لا يتطابق الاثنان —
 * وهي أشهر أسباب «الاشتراك موجود لكن لا يصل شيء» في الويب.
 */
async function vapidKeyMatchesPublic(privateKey: CryptoKey): Promise<boolean> {
  try {
    const pub = wpB64urlDec(WEBPUSH_VAPID_PUBLIC_KEY);
    if (pub.length !== 65) return false;
    const publicKey = await crypto.subtle.importKey(
      'raw',
      pub,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const probe = textEncoder.encode('vapid-self-test');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, probe);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, probe);
  } catch (e) {
    console.error('[push-notify] vapid self-test failed:', String(e));
    return false;
  }
}
/** يشفّر حمولة Web Push حسب RFC 8291 (aes128gcm) ويعيد الجسم الجاهز للإرسال. */
async function encryptWebPushPayload(clientKeyB64: string, authB64: string, plaintext: string): Promise<Uint8Array> {
  const clientKeyRaw = wpB64urlDec(clientKeyB64);
  if (clientKeyRaw.length !== 65) throw new Error(`p256dh غير صالح (${clientKeyRaw.length} بايت)`);
  const authSecret = wpB64urlDec(authB64);
  if (authSecret.length !== 16) throw new Error(`auth غير صالح (${authSecret.length} بايت)`);

  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPublicKey }, serverKeys.privateKey, 256),
  );

  // IKM = HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info\0" || ua_public || as_public)
  const keyInfo = wpConcat(textEncoder.encode('WebPush: info\u0000'), clientKeyRaw, asPublic);
  const ikm = await wpHkdf(ecdhSecret, authSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await wpHkdf(ikm, salt, textEncoder.encode('Content-Encoding: aes128gcm\u0000'), 16);
  const nonce = await wpHkdf(ikm, salt, textEncoder.encode('Content-Encoding: nonce\u0000'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plain = textEncoder.encode(plaintext);
  // 0x02 = علامة آخر سجل (padding delimiter)
  const padded = wpConcat(plain, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, padded),
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, WEBPUSH_RECORD_SIZE, false);
  header[20] = 65; // طول مفتاح الخادم
  header.set(asPublic, 21);

  return wpConcat(header, ciphertext);
}

async function sendWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: string,
  vapidKey: CryptoKey,
  keyVerified = false,
): Promise<{ ok: boolean; status: number; gone: boolean; error?: string }> {
  try {
    let body: Uint8Array;
    let jwt: string;
    try {
      body = await encryptWebPushPayload(p256dh, auth, payload);
      const audience = new URL(endpoint).origin;
      jwt = await buildVapidJwt(audience, vapidKey);
    } catch (e) {
      // خطأ محلي قبل أي إرسال (base64 تالف في p256dh/auth، أو endpoint غير
      // صالح). إعادة المحاولة لن تنجح أبداً → الصف ميت ويُحذف.
      console.error(`[webpush] prepare error (dead row): ${String(e)}`);
      return { ok: false, status: 0, gone: true, error: String(e).slice(0, 160) };
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: {
        Authorization: `vapid t=${jwt}, k=${WEBPUSH_VAPID_PUBLIC_KEY}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
    });
    const ok = res.status === 200 || res.status === 201 || res.status === 202;
    if (!ok) {
      const text = await res.text().catch(() => '');
      console.error(`[webpush] ${res.status} ${text.slice(0, 200)}`);
      // 404/410 = الاشتراك لم يعد موجوداً.
      // 401/403 = توقيع VAPID مرفوض؛ إن كان المفتاح مُتحقَّقاً فهذا يعني أن
      // الاشتراك أُنشئ بمفتاح عام آخر (تدوير مفاتيح) → صف ميت يجب حذفه
      // ليعيد المتصفح التسجيل بالمفتاح الحالي.
      const staleKey = keyVerified && (res.status === 401 || res.status === 403);
      return {
        ok: false,
        status: res.status,
        gone: res.status === 404 || res.status === 410 || staleKey,
        error: `${res.status} ${text.slice(0, 160)}`,
      };
    }
    return { ok: true, status: res.status, gone: false };
  } catch (e) {
    console.error(`[webpush] send error: ${String(e)}`);
    return { ok: false, status: 0, gone: false, error: String(e).slice(0, 160) };
  }
}

// ---------- HTTP handler ----------

// التطبيق (متصفح/PWA) يستدعي الدالة للتسجيل، فالبوابة تحتاج CORS صريحاً
// للطلبات المسبقة (preflight) ولقراءة الرد.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  // ملاحظة: فحص السر المشترك (WEBHOOK_SECRET) تم نقله إلى ما بعد معالجة
  // طلبات تسجيل الجهاز (register/unregister) — لأن تلك الطلبات تأتي من
  // التطبيق بمفتاح anon ولا تحمل السر. انظر أدناه.

  let body: {
    type?: string;
    table?: string;
    record?: PushRecord;
    old_record?: PushRecord;
    title?: string;
    body?: string;
    department?: string | null;
    // ---- تسجيل الجهاز من العميل (register / unregister) ----
    kind?: 'fcm' | 'web';
    token?: string;
    endpoint?: string;
    p256dh?: string;
    auth?: string;
    platform?: string;
    is_developer?: boolean;
    alerts_enabled?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // ---------- تسجيل/إلغاء تسجيل من التطبيق ----------
  // لماذا من هنا وليس من العميل مباشرة؟ جداول push_tokens /
  // web_push_subscriptions محمية بـ RLS، والتطبيق يكتب بمفتاح anon بلا JWT
  // ⇒ كل insert/upsert كان يرجع 42501 (new row violates row-level security).
  // هنا نكتب بمفتاح service role (يتجاوز RLS) فينجح التسجيل بلا أي تعديل على
  // سياسات القاعدة. هذا المسار لا يتطلب السر المشترك لأنه يأتي من المستخدم.
  if (body.type === 'register' || body.type === 'unregister') {
    if (!supabaseUrl || !serviceKey) {
      return jsonRes({ error: 'missing service credentials' }, 500);
    }
    const kind = body.kind === 'web' ? 'web' : 'fcm';
    const supabase = createClient(supabaseUrl, serviceKey);
    const isUnregister = body.type === 'unregister';

    if (kind === 'fcm') {
      const token = (body.token ?? '').trim();
      // توكنات FCM طويلة (عادة 150+ حرف) — نرفض القيم العبثية مبكراً.
      if (token.length < 20 || token.length > 4096) {
        return jsonRes({ error: 'invalid token' }, 400);
      }
      if (isUnregister) {
        const { error } = await supabase.from('push_tokens').delete().eq('token', token);
        if (error) {
          return jsonRes({ error: error.message }, 500);
        }
        return jsonRes({ ok: true, removed: true });
      }
      const { error } = await supabase.from('push_tokens').upsert(
        {
          token,
          platform: body.platform ?? 'android',
          department: body.department ?? null,
          is_developer: body.is_developer === true,
          alerts_enabled: body.alerts_enabled !== false,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      );
      if (error) {
        console.error('[register] fcm upsert failed:', error.code, error.message);
        return jsonRes({ error: error.message }, 500);
      }
      return jsonRes({ ok: true, kind: 'fcm' });
    }

    const endpoint = (body.endpoint ?? '').trim();
    const p256dh = (body.p256dh ?? '').trim();
    const authKey = (body.auth ?? '').trim();
    if (!endpoint.startsWith('https://') || endpoint.length > 2048) {
      return jsonRes({ error: 'invalid endpoint' }, 400);
    }
    if (isUnregister) {
      const { error } = await supabase
        .from('web_push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);
      if (error) {
        return jsonRes({ error: error.message }, 500);
      }
      return jsonRes({ ok: true, removed: true });
    }
    if (p256dh.length < 20 || p256dh.length > 512 || authKey.length < 8 || authKey.length > 256) {
      return jsonRes({ error: 'invalid subscription keys' }, 400);
    }
    const { error } = await supabase.from('web_push_subscriptions').upsert(
      {
        endpoint,
        p256dh,
        auth: authKey,
        department: body.department ?? null,
        is_developer: body.is_developer === true,
        alerts_enabled: body.alerts_enabled !== false,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );
    if (error) {
      console.error('[register] web upsert failed:', error.code, error.message);
      return jsonRes({ error: error.message }, 500);
    }
    return jsonRes({ ok: true, kind: 'web' });
  }

  // ---------- فحص السر المشترك (لطلبات المشغّل/الويب هوك) ----------
  // مشغّل قاعدة البيانات يرسل دائماً:
  //   Authorization: Bearer <anon key>   (لعبور بوابة الدوال)
  //   x-webhook-secret: <WEBHOOK_SECRET>
  // لذلك يجب فحص x-webhook-secret أولاً، وإلا صار كل استدعاء من المشغّل 401
  // بسبب مقارنة مفتاح الـ anon بالسر المشترك.
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (webhookSecret) {
    const headerSecret = req.headers.get('x-webhook-secret');
    const auth = req.headers.get('authorization') ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    const provided = headerSecret ?? bearer;
    if (provided !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
  }

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

  // ---------- مفتاح VAPID الخاص بـ Web Push ----------
  // يقبل أسماء متعددة للسر لأن كل لوحة/سكربت يسمّيه بشكل مختلف.
  const vapidRaw =
    Deno.env.get('WEBPUSH_VAPID_PRIVATE_KEY') ??
    Deno.env.get('VAPID_PRIVATE_KEY_PKCS8_B64') ??
    Deno.env.get('VAPID_PRIVATE_KEY_JWK_D') ??
    Deno.env.get('VAPID_PRIVATE_KEY') ??
    '';
  let vapidKey: CryptoKey | null = null;
  let vapidKeyError = '';
  if (!vapidRaw) {
    console.warn('[push-notify] WEBPUSH_VAPID_PRIVATE_KEY not set — Web Push will be skipped');
  } else {
    try {
      vapidKey = await loadVapidPrivateKey(vapidRaw);
    } catch (e) {
      vapidKeyError = String(e);
      console.error('[push-notify] مفتاح VAPID غير صالح:', vapidKeyError);
    }
  }

  // Content source 1: Database Webhook (INSERT or UPDATE event)
  let content: { title: string; body: string; tab: string; urgent: boolean } | null = null;
  let dept: string | null = null;
  let sourceTable = 'notifications';
  let recordId = '';
  const evt: 'INSERT' | 'UPDATE' = body.type === 'UPDATE' ? 'UPDATE' : 'INSERT';

  if (body.record && body.table) {
    if (body.type && body.type !== 'INSERT' && body.type !== 'UPDATE') {
      return new Response(JSON.stringify({ skipped: true, reason: `ignored event ${body.type}` }), { status: 200 });
    }
    if (evt === 'UPDATE' && body.old_record && !isMeaningfulUpdate(body.table, body.old_record, body.record)) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no meaningful change' }), { status: 200 });
    }
    content = buildContent(body.table, body.record, evt);
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
  if (vapidKey) {
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
    // Lets the foreground handler dedupe UPDATE pushes with the Realtime
    // UPDATE popup (markSeen uses a per-evt key: insert vs update).
    evt: evt === 'UPDATE' ? 'update' : 'insert',
  };

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];
  const fcmStatuses: number[] = [];
  const fcmErrors: string[] = [];

  // Send to all devices CONCURRENTLY — a sequential loop would make the
  // dispatch time grow linearly with the number of devices (0.3s each).
  const results = await Promise.all(
    tokens.map(async (row) => {
      try {
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
                  // FCM v1 (HTTP v1) expects the enum NAME "HIGH" (uppercase),
                  // NOT the legacy lowercase "high". Lowercase is silently
                  // ignored -> NORMAL priority -> delivery is deferred while
                  // the device is idle/Doze (looks like "never arrives" when
                  // the app is closed).
                  priority: 'HIGH',
                  notification: {
                    // Explicitly pass title/body at the Android level: some
                    // FCM v1 clients do NOT fall back to the top-level
                    // `notification` title/body when `android.notification`
                    // is present, which would render an empty tray entry.
                    title: content.title,
                    body: content.body,
                    channel_id: channelId,
                    // Tints the small icon + app name so the tray matches app brand.
                    color: notifyColor,
                    default_vibrate_timings: true,
                    default_sound: true,
                    // FCM v1 visibility enum: PUBLIC = show fully on lock screen.
                    visibility: 'PUBLIC',
                  },
                },
              },
            }),
          },
        );
        if (res.ok) {
          return { ok: true, dead: false, status: res.status, error: '' };
        }
        const text = await res.text();
        console.error(`[push-notify] send failed: ${res.status} ${text}`);
        return { ok: false, dead: isUnregistered(text), status: res.status, error: text.slice(0, 200) };
      } catch (e) {
        console.error(`[push-notify] send error: ${String(e)}`);
        return { ok: false, dead: false, status: 0, error: String(e).slice(0, 200) };
      }
    }),
  );
  results.forEach((r, i) => {
    if (r.ok) {
      sent += 1;
    } else {
      failed += 1;
      fcmStatuses.push(r.status);
      if (r.error) fcmErrors.push(r.error);
      if (r.dead) deadTokens.push(tokens[i].token as string);
    }
  });

  // Prune tokens FCM reports as gone so retries stay fast.
  for (const dead of deadTokens) {
    await supabase.from('push_tokens').delete().eq('token', dead);
  }

  // ---------- Web Push sending (PWA / browser installs) ----------
  let webSent = 0;
  let webFailed = 0;
  const deadWebSubs: string[] = [];

  const webStatuses: number[] = [];
  const webErrors: string[] = [];

  if (vapidKey && webSubs.length > 0) {
    // فحص مرة واحدة: هل المفتاح الخاص يطابق المفتاح العام المعلن؟
    // إن لم يطابق، فكل 401/403 سببها المفتاح وليست الاشتراكات → لا نحذفها.
    const keyVerified = await vapidKeyMatchesPublic(vapidKey);
    if (!keyVerified) {
      console.error('[push-notify] VAPID: المفتاح الخاص لا يطابق المفتاح العام — كل إرسال الويب سيفشل');
    }
    // Also concurrent, same reason as the FCM loop above.
    const webResults = await Promise.all(
      webSubs.map(async (sub) => {
        const res = await sendWebPush(
          sub.endpoint,
          sub.p256dh,
          sub.auth,
          JSON.stringify({
            title: content.title,
            body: content.body,
            tab: content.tab,
            urgent: content.urgent,
          }),
          vapidKey as CryptoKey,
          keyVerified,
        );
        return { endpoint: sub.endpoint, ...res };
      }),
    );
    for (const r of webResults) {
      webStatuses.push(r.status);
      if (r.ok) {
        webSent += 1;
      } else {
        webFailed += 1;
        if (r.error) webErrors.push(r.error);
        if (r.gone) deadWebSubs.push(r.endpoint);
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
      // تشخيص سريع: أكواد HTTP لخدمة الـ push + أول رسائل الخطأ
      webStatuses,
      webErrors: webErrors.slice(0, 3),
      fcmStatuses,
      fcmErrors: fcmErrors.slice(0, 3),
      vapidReady: Boolean(vapidKey),
      vapidKeyError: vapidKeyError || undefined,
      // false = المفتاح الخاص في الأسرار لا يطابق WEBPUSH_VAPID_PUBLIC_KEY
      // (سبب 401/403 من خدمات Push رغم وجود اشتراك سليم).
      vapidKeyMatchesPublic: vapidKey ? await vapidKeyMatchesPublic(vapidKey) : false,
      title: content.title,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
