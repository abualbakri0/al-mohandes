# خطة Play Integrity: رفض تشغيل/الكتابة من نسخة APK معدّلة

> الهدف: إثبات أن الطلب يأتي من **حزمة `com.almohanndes.app` الحقيقية، موقّعة
> بمفتاحك، على جهاز سليم** — ثم رفض كل ما عدا ذلك على الخادم.
> **الخادم هو الحكم، لا التطبيق.** أي حماية داخل APK وحده يمكن تعطيلها بـpatch.

## 0) لماذا Play Integrity وليس Firebase App Check؟

| الخيار | يحمي | يناسبنا؟ |
|---|---|---|
| **App Check** (provider: Play Integrity) | موارد **Firebase** فقط: Firestore, RTDB, Storage, Callable Functions | ❌ لا. مخزننا هو Supabase (PostgREST)، وApp Check لا يضيف ترويسة يفهمها PostgREST. استخدامه هنا = تعقيد بلا أثر. |
| **Play Integrity API** مباشرة | أي خادم تملكه (Supabase Edge Function هنا) | ✅ نعم — أنت من يقرأ الحكم ويقرّر. |
| تثبيت بصمة التوقيع (موجود) | إعادة توقيع/تجديد APK | ✅ يعمل بلا إنترنت، لكن يمكن تعطيله بـpatch. |

الخلاصة: **App Check غير منطبق** على هذه المعمارية؛ البديل الصحيح هو Play
Integrity + تحقّق على الخادم. (لو هاجرت لاحقاً لخدمات Firebase، App Check يصبح
إضافة مجانية فوق هذا.)

## 1) المعمارية

```
[APK] 1. GET nonce  ────────────────▶  Edge Function: attest-device (action=nonce)
                                        └─ يوقّع: nonce.exp.HMAC  (بلا قاعدة بيانات)
      2. IntegrityTokenRequest.setNonce(nonce)
         Google Play Services ──────▶ token مشفّر
      3. POST { token }  ──────────▶  Edge Function (action=verify)
                                        ├─ decodeIntegrityToken عبر Google API
                                        ├─ يتحقّق: package, cert SHA-256, nonce, عمر,
                                        │          appRecognitionVerdict, deviceVerdict
                                        └─ يُنشئ جلسة: token عشوائي (hash فقط يُخزَّن)
      4. كل كتابة حسّاسة: ترويسة x-attest-token ──▶ PostgREST → RLS تنادي is_attested()
```

نقطة قوة هذا التصميم: المنع **داخل RLS**، فلا يستطيع أحد تجاوزه بنداء REST
مباشر بالمفتاح العام الموجود في الـAPK.

## 2) المتطلبات (مرة واحدة)

1. **Play Console** → تطبيقك → *Test and release* → *App integrity* →
   *Play Integrity API* → **Link Cloud project** (أنشئ مشروعاً أو اربط موجوداً).
   سجّل **رقم** المشروع (Project number، ليس ID).
2. **Google Cloud Console** (نفس المشروع) → APIs → تفعيل **Google Play Integrity API**.
3. إنشاء **Service Account** → مفتاح JSON → دوره يكفي لاستدعاء الـAPI
   (`roles/monitoring.viewer` غير مطلوب؛ الصلاحية تكفي عبر تفعيل الـAPI، ويُفضّل
   دور مخصّص بصلاحية `playintegrity.decode`).
4. تخزين الأسرار في Supabase:
   ```powershell
   npx supabase secrets set PLAY_INTEGRITY_SA_JSON="<محتوى JSON كاملاً>"
   npx supabase secrets set PLAY_INTEGRITY_PACKAGE="com.almohanndes.app"
   npx supabase secrets set ATTEST_NONCE_SECRET="<64 حرف hex عشوائي>"
   ```
5. **بصمة شهادة التوقيع** (SHA-256 كـbase64، وهي صيغة Play Integrity، لا hex):
   تُقرأ من `keystore.properties` بنفس منطق `build.gradle`، وتُخزَّن سراً:
   ```powershell
   npx supabase secrets set PLAY_INTEGRITY_CERT_SHA256_B64="<base64>"
   ```
6. `versionCode` الحالي (34) يُقارَن أيضاً في الخادم.

> ⚠️ **قيد جوهري:** `PLAY_RECOGNIZED` لا يظهر إلا لنسخة **مثبّتة من Google Play**.
> نسخة تُرسل عبر تيليجرام/رابط مباشر ستحصل على `UNEVALUATED` أو بدون
> `PLAY_RECOGNIZED` ⇒ لهذا الخطة **مرحلية** ولا تحظر في المرحلة الأولى.

## 3) المراحل (لا تقفز مرحلة)

| المرحلة | ما يُفعَّل | سلوك عند الفشل | مدة القياس |
|---|---|---|---|
| **0 — الآن** | بصمة التوقيع + R8 + تشويش JS | رفض تشغيل عند إعادة التوقيع | مُنفَّذ |
| **1 — قياس** | استدعاء Play Integrity وتسجيل الحكم فقط | **لا شيء** (تسجيل فقط) | 1–2 أسبوع |
| **2 — بوّابة الكتابة** | الكتابات الحسّاسة (تسجيل، اعتماد، حذف، نشر) تتطلّب `is_attested()` | رسالة عربية + إعادة محاولة | أسبوع |
| **3 — بوّابة كاملة** | كل RPC مخصّص + دوال الحافة | رفض 403 | دائم |

## 4) قاعدة البيانات (المرحلة 1 — آمنة، لا تحظر شيئاً)

```sql
-- supabase/migrations/20261101090000_play_integrity_attestation.sql
-- جدول جلسات التصديق. لا يُقرأ من العميل إطلاقاً: RLS مفعّل بلا سياسات،
-- والوصول فقط عبر service_role (دوال الحافة) أو is_attested().
create table if not exists public.attest_sessions (
  token_hash    text primary key,           -- sha256(token) وليس التوكن نفسه
  user_id       uuid references auth.users(id) on delete cascade,
  platform      text not null default 'android',
  app_version   text,
  app_verdict   text,                       -- PLAY_RECOGNIZED | UNRECOGNIZED_VERSION | UNEVALUATED
  device_verdicts text[] not null default '{}',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
alter table public.attest_sessions enable row level security;
revoke all on public.attest_sessions from anon, authenticated;
create index if not exists attest_sessions_expires_idx on public.attest_sessions (expires_at);

-- هل الطلب الحالي صادر عن جلسة تصديق سارية؟
-- PostgREST يمرّر ترويسات الطلب إلى SQL عبر current_setting('request.headers').
create or replace function public.is_attested()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.attest_sessions s
    where s.token_hash = encode(
            digest(coalesce(current_setting('request.headers', true)::json ->> 'x-attest-token', ''), 'sha256'),
            'hex')
      and s.expires_at > now()
      and (s.user_id is null or s.user_id = auth.uid())
  );
$$;

revoke all on function public.is_attested() from public;
grant execute on function public.is_attested() to anon, authenticated;
```

> في المرحلة 1 لا يُستخدم `is_attested()` في أي سياسة — الجدول يُملأ فقط.
> في المرحلة 2 تُضاف `and public.is_attested()` إلى سياسات الكتابة الحسّاسة،
> وفي المرحلة 3 إلى كل الدوال المخصّصة.

**تنظيف دوري** (بنفس أسلوب حارس المشروع الحالي):
```sql
create or replace function public.purge_attest_sessions()
returns integer language sql security definer set search_path = public, pg_temp as $$
  with gone as (delete from public.attest_sessions where expires_at < now() - interval '1 day' returning 1)
  select count(*)::int from gone;
$$;
```

## 5) دالة الحافة `attest-device` (الجزء 1: nonce والتحقق منه)

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PACKAGE = Deno.env.get('PLAY_INTEGRITY_PACKAGE') ?? 'com.almohanndes.app';
const EXPECTED_CERT = Deno.env.get('PLAY_INTEGRITY_CERT_SHA256_B64') ?? '';
const NONCE_SECRET = Deno.env.get('ATTEST_NONCE_SECRET') ?? '';
const SA_JSON = Deno.env.get('PLAY_INTEGRITY_SA_JSON') ?? '';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text: string) => b64url(enc.encode(text));
const fromB64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(NONCE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** nonce موقّع بلا حالة: يمكن التحقق منه دون تخزين في قاعدة البيانات. */
async function issueNonce(): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const exp = Math.floor(Date.now() / 1000) + 300; // 5 دقائق
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(`${nonce}.${exp}`));
  return `${nonce}.${exp}.${b64url(new Uint8Array(signature))}`;
}

async function assertFreshNonce(signed: string): Promise<void> {
  const [nonce, expRaw, signature] = signed.split('.');
  if (!nonce || !expRaw || !signature) throw new Error('nonce مشوّه');
  if (Number(expRaw) * 1000 < Date.now()) throw new Error('nonce منتهي');
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    fromB64url(signature),
    enc.encode(`${nonce}.${expRaw}`),
  );
  if (!ok) throw new Error('توقيع nonce غير صالح');
}
```



## 6) دالة الحافة `attest-device` (الجزء 2: التحقق من Google وإصدار الجلسة)

```ts
// ---------- التحقق عبر Google Play Integrity API ----------
async function importSaKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

/** OAuth2 عبر JWT Bearer — بلا أي مكتبة خارجية. */
async function accessToken(): Promise<string> {
  const sa = JSON.parse(SA_JSON) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    b64urlText(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/playintegrity',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3300,
      }),
    );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importSaKey(sa.private_key),
    enc.encode(unsigned),
  );
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OAuth: ${json.error_description ?? json.error ?? res.status}`);
  return json.access_token as string;
}

interface Verdict {
  packageName: string;
  cert: string;
  versionCode: string;
  appVerdict: string;
  deviceVerdicts: string[];
  nonce: string;
}

async function decodeToken(integrityToken: string): Promise<Verdict> {
  const res = await fetch(`https://playintegrity.googleapis.com/v1/${PACKAGE}:decodeIntegrityToken`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ integrity_token: integrityToken }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`decode: ${json?.error?.message ?? res.status}`);

  const p = json.tokenPayloadExternal ?? {};
  return {
    packageName: p.requestDetails?.requestPackageName ?? '',
    cert: (p.appIntegrity?.certificateSha256Digest ?? [])[0] ?? '',
    versionCode: String(p.appIntegrity?.versionCode ?? ''),
    appVerdict: p.appIntegrity?.appRecognitionVerdict ?? 'UNEVALUATED',
    deviceVerdicts: p.deviceIntegrity?.deviceRecognitionVerdict ?? [],
    nonce: p.requestDetails?.nonce ?? '',
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
};
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === 'nonce') return json({ nonce: await issueNonce() }, 200);
    if (body.action !== 'verify' || typeof body.token !== 'string') {
      return json({ error: 'طلب غير صالح' }, 400);
    }

    const verdict = await decodeToken(body.token);
    await assertFreshNonce(verdict.nonce); // يمنع إعادة استخدام توكن قديم
    if (verdict.packageName !== PACKAGE) throw new Error('اسم حزمة مختلف');
    if (EXPECTED_CERT && verdict.cert !== EXPECTED_CERT) throw new Error('شهادة توقيع مختلفة');

    // المرحلة 1: نسجّل الحكم فقط ولا نمنع (ATTEST_ENFORCE غير مضبوط).
    // المرحلة 2+: ATTEST_ENFORCE=1 ⇒ الجهاز المروّت/المحاكي يُرفض هنا.
    const enforce = Deno.env.get('ATTEST_ENFORCE') === '1';
    const deviceOk = verdict.deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY');
    if (enforce && !deviceOk) throw new Error('الجهاز غير موثوق');

    // جلسة: التوكن يذهب للعميل، وقاعدة البيانات تحفظ sha256 فقط.
    const session = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const { error } = await admin()
      .from('attest_sessions')
      .insert({
        token_hash: await sha256Hex(session),
        user_id: typeof body.userId === 'string' ? body.userId : null,
        platform: 'android',
        app_version: verdict.versionCode,
        app_verdict: verdict.appVerdict,
        device_verdicts: verdict.deviceVerdicts,
        expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
      });
    if (error) throw new Error(error.message);

    return json(
      {
        session,
        expiresIn: SESSION_TTL_SECONDS,
        verdicts: {
          app: verdict.appVerdict,
          device: verdict.deviceVerdicts,
          versionCode: verdict.versionCode,
        },
      },
      200,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'فشل التحقق' }, 403);
  }
});
```

**نشر:**
```powershell
npx supabase functions deploy attest-device --project-ref wulycdwgvpriptzubazi --no-verify-jwt
```

## 7) جانب أندرويد (المرحلة 2) — بلجن Java + الاعتماديات

**1. `android/app/build.gradle` → `dependencies { … }`:**
```groovy
implementation "com.google.android.play:integrity:1.4.0"
```

**2. ملف جديد `android/app/src/main/java/com/almohanndes/app/PlayIntegrityPlugin.java`:**
```java
package com.almohanndes.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;
import com.google.android.play.core.integrity.IntegrityTokenResponse;

/**
 * يطلب توكن Play Integrity لـnonce صادر من خادمك. لا يقرّر شيئاً بنفسه:
 * القرار كله في دالة الحافة — أي تعديل هنا لا يفيد المهاجم.
 */
@CapacitorPlugin(name = "PlayIntegrity")
public class PlayIntegrityPlugin extends Plugin {

    @PluginMethod
    public void requestToken(PluginCall call) {
        String nonce = call.getString("nonce");
        Long projectNumber = call.getLong("cloudProjectNumber");
        if (nonce == null || nonce.isEmpty() || projectNumber == null) {
            call.reject("nonce و cloudProjectNumber مطلوبان");
            return;
        }

        IntegrityManager manager = IntegrityManagerFactory.create(getContext());
        IntegrityTokenRequest request = IntegrityTokenRequest.builder()
                .setNonce(nonce)
                .setCloudProjectNumber(projectNumber)
                .build();

        manager.requestIntegrityToken(request)
                .addOnSuccessListener((IntegrityTokenResponse response) -> {
                    JSObject result = new JSObject();
                    result.put("token", response.token());
                    call.resolve(result);
                })
                .addOnFailureListener((Exception e) ->
                        call.reject("Play Integrity: " + e.getMessage(), e));
    }
}
```

**3. التسجيل في `MainActivity.onCreate` قبل `super.onCreate`** (سطر واحد):
```java
        // قبل super.onCreate: Capacitor يسجّل البلجنات المحلية هنا فقط.
        registerPlugin(PlayIntegrityPlugin.class);
        super.onCreate(savedInstanceState);
```
> ملاحظة R8: البلجن يبقى تلقائياً بفضل قاعدة `@CapacitorPlugin` + قاعدة
> `@PluginMethod` في `proguard-rules.pro`. لا حاجة لقاعدة إضافية.

## 8) جانب الويب/TS (المرحلة 2) — جلسة تصديق واحدة لكل تشغيل

```ts
// src/lib/attest.ts
import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from './supabase';          // عدّل المسار حسب مشروعك

interface PlayIntegrityPlugin {
  requestToken(options: { nonce: string; cloudProjectNumber: number }): Promise<{ token: string }>;
}

const PlayIntegrity = registerPlugin<PlayIntegrityPlugin>('PlayIntegrity');
const CLOUD_PROJECT_NUMBER = 000000000000;      // ← رقم مشروع GCP (ليس الـID)

let cached: { token: string; expiresAt: number } | null = null;

/** يُنشئ جلسة تصديق (أو يعيد الجلسة المخزّنة) — null على الويب/عند الفشل. */
export async function ensureAttestSession(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;       // الويب: مسار منفصل
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  try {
    const { data: nonceData } = await supabase.functions.invoke('attest-device', {
      body: { action: 'nonce' },
    });
    if (!nonceData?.nonce) return null;

    const { token } = await PlayIntegrity.requestToken({
      nonce: nonceData.nonce,
      cloudProjectNumber: CLOUD_PROJECT_NUMBER,
    });
    const { data: userData } = await supabase.auth.getUser();

    const { data: session } = await supabase.functions.invoke('attest-device', {
      body: { action: 'verify', token, userId: userData.user?.id ?? null },
    });
    if (!session?.session) return null;

    cached = { token: session.session, expiresAt: Date.now() + session.expiresIn * 1000 };
    return cached.token;
  } catch {
    return null;   // المرحلة 2: نفشل بهدوء ونمنع الكتابة فقط، لا نُخرج المستخدم
  }
}

/** كل كتابة محمية تمرّ من هنا — تُضيف الترويسة التي تقرأها is_attested(). */
export async function attestedRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<{ data: T | null; error: { message: string } | null }> {
  const token = await ensureAttestSession();
  if (!token) return { data: null, error: { message: 'تعذّر التحقق من التطبيق — أعد فتح التطبيق' } };
  return supabase.rpc(fn, args, { headers: { 'x-attest-token': token } }) as never;
}
```

**نقاط التركيب:** استبدل نداءات `supabase.rpc('register_student' …)` و`approve…`
و`delete…` و`create_post…` بـ`attestedRpc(...)`. القراءات تبقى كما هي في المرحلة 2.

## 9) المرحلة 2 → 3: تحويل البوّابة إلى RLS (مثال)

```sql
-- مثال: منع التسجيل من نسخة غير مصدَّقة (المرحلة 2)
drop policy if exists "students can register" on public.students;
create policy "students can register" on public.students
  for insert to authenticated
  with check (public.is_attested() and auth.uid() = user_id);

-- المرحلة 3: كل دوال المطوّر المخصّصة
create or replace function public.assert_attested()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_attested() then
    raise exception 'app_not_attested' using errcode = '42501';
  end if;
end;
$$;
-- ثم في بداية كل دالة حسّاسة: perform public.assert_attested();
```

العميل يترجم `42501 / app_not_attested` إلى رسالة عربية واضحة
(«تحقّق من تحديث التطبيق من المصدر الرسمي») بدل خطأ خام.

## 10) النشر والتراجع

| الخطوة | الأمر / الإجراء | التراجع |
|---|---|---|
| الهجرة | `supabase db push` أو SQL Editor | `drop function public.is_attested(); drop table public.attest_sessions;` |
| الدالة | `supabase functions deploy attest-device --no-verify-jwt` | `supabase functions delete attest-device` |
| المنع | `supabase secrets set ATTEST_ENFORCE=1` | `set ATTEST_ENFORCE=0` (يسري فوراً بلا إعادة نشر) |
| العميل | بناء APK جديد + `versionCode++` | السياسات تُخفَّف، لا يُجبَر أحد على تحديث فوري |

**الترتيب إلزامي:** هجرة ← دالة ← APK يرسل الترويسة ← **ثم** `ATTEST_ENFORCE=1`.
عكس الترتيب = إغلاق التطبيق على كل المستخدمين.

## 11) قيود صريحة (يجب أن تعرفها قبل التفعيل)

1. **`PLAY_RECOGNIZED` يتطلّب تثبيتاً من Google Play.** نسخة تيليجرام/رابط مباشر
   تُعطي غالباً `UNEVALUATED`. لذلك الخطة تقيس أولاً ولا تحظر على هذا الحكم.
2. **أجهزة بلا خدمات Google (Huawei القديمة)**: لا توكن ⇒ لا تصديق. تحتاج
   مساراً بديلاً (تسجيل يدوي من المطوّر) وإلا فقدت هؤلاء الطلاب.
3. **أجهزة مروّتة/رومات مخصّصة**: `MEETS_DEVICE_INTEGRITY` غائب ⇒ رفض في
   المرحلة 3. قرار منتج، لا قرار تقني.
4. **المحاكي**: يُرفض دائماً تقريباً — لا تختبر عليه بعد التفعيل.
5. **الحصة**: الحصة المجانية اليومية تكفي تطبيقاً بهذا الحجم؛ راقب
   *Play Console → Play Integrity API → Usage* قبل أي توسّع. التوكن يُطلب مرة
   واحدة لكل تشغيل (TTL 12 ساعة) لا مع كل طلب.
6. **لا يحمي من مهاجم يملك حساباً شرعياً** ويستخدم التطبيق الأصلي — هذه الطبقة
   تمنع *النسخ المعدّلة*، لا إساءة الاستخدام من داخل التطبيق الأصلي.

## 12) معايير القبول قبل/بعد كل مرحلة

- [ ] `select public.is_attested();` بلا ترويسة → `false` (وليس خطأ).
- [ ] طلب `attest-device` بـtoken مزوّر → 403 ورسالة واضحة.
- [ ] إعادة استخدام نفس التوكن مرتين → 403 (nonce يُستهلك/ينتهي).
- [ ] APK موقّع بمفتاح مختلف → فشل في الخادم (شهادة مختلفة) + رفض محلي أصلاً.
- [ ] جهاز طالب حقيقي: جلسة تُنشأ، والكتابات تعمل.
- [ ] `attest_sessions` لا تُقرأ بـanon (RLS بلا سياسات).
- [ ] قياس المرحلة 1: نسبة الأجهزة الحاصلة على `MEETS_DEVICE_INTEGRITY`
      و`PLAY_RECOGNIZED` — **لا تنتقل للمرحلة 2 قبل أن تعرف الرقمين**.


