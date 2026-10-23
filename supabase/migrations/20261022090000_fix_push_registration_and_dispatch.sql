-- ============================================================================
-- إصلاح جذري لتسجيل الأجهزة + إرسال الإشعارات (Push) — 22 أكتوبر 2026
-- ============================================================================
-- السبب المؤكد (تم التحقق منه فعلياً على المشروع الحقيقي عبر REST):
--
--   POST /rest/v1/push_tokens?on_conflict=token   ← نفس ما يفعله src/lib/push.ts
--   => HTTP 401 / code 42501
--      "new row violates row-level security policy for table push_tokens"
--
--   POST /rest/v1/push_tokens  (مع return=representation) => 42501 أيضاً
--
-- أي أن: SELECT و UPDATE محجوبان على push_tokens، والـ upsert يحتاج
-- سياسة UPDATE (فرع ON CONFLICT DO UPDATE) ⇒ **كل جهاز جديد يفشل في تسجيل
-- التوكن بهدوء**، فلا يوجد صف في push_tokens، فلا يصل أي إشعار في الخلفية.
--
-- هذا الملف (idempotent — شغّله أكثر من مرة بأمان):
--   1) يعيد سياسات RLS لـ push_tokens و web_push_subscriptions.
--   2) يضيف الأعمدة is_developer / updated_at إن كانت مفقودة.
--   3) يضيف دوال RPC (SECURITY DEFINER) تسجّل التوكن/الاشتراك متجاوزة RLS
--      ⇒ التطبيق يظل يعمل حتى لو انكسرت السياسات مستقبلاً.
--   4) يعيد إنشاء دالة ومشغلات الإرسال إلى Edge Function push-notify
--      + أسرار Vault (push_notify_url / supabase_anon_key / push_webhook_secret).
--   5) يضيف push_diag() لتشخيص الحالة من داخل التطبيق أو من SQL Editor.
--
-- ⚠️ تحديث مهم (بعد التحقق الحقيقي من المشروع):
--   • صار التطبيق يسجّل الجهاز عبر دالة الحافة push-notify نفسها
--     (type: 'register' / 'unregister')، والدالة تكتب بمفتاح service role
--     ⇒ التسجيل يعمل الآن حتى بدون تشغيل هذا الملف. أقسام RLS/RPC هنا
--     صارت "دفاعاً إضافياً" (defense in depth) وليست شرطاً للتسجيل.
--   • الأقسام 5-7 (pg_net + المشغّلات + أسرار Vault) تبقى **ضرورية**:
--     بدونها لن تُرسل أي إشعار عند إضافة/تعديل بيانات من التطبيق.
--   • مفاتيح VAPID تم تدويرها (23 أكتوبر 2026) والمفتاح العام الجديد:
--     BAVbmfT7ueuA7jIEhBCuBLrmqHARowQiSTtM6Y9b6DHOi0gts71gpaGpu7udDKhNa1nMJQwjT9BqdzPeAnyKsN4
--     (موجود في src/lib/webPush.ts و supabase/functions/push-notify/index.ts)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) push_tokens — أعمدة مفقودة + سياسات RLS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.push_tokens') IS NULL THEN
    RAISE WARNING 'push_tokens غير موجود — تخطي';
    RETURN;
  END IF;

  ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS is_developer BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'android';
  ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT true;
  ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

  ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

  -- كل السياسات القديمة/البديلة بأسمائها المحتملة
  DROP POLICY IF EXISTS "anon_select_push_tokens" ON public.push_tokens;
  DROP POLICY IF EXISTS "anon_insert_push_tokens" ON public.push_tokens;
  DROP POLICY IF EXISTS "anon_update_push_tokens" ON public.push_tokens;
  DROP POLICY IF EXISTS "anon_delete_push_tokens" ON public.push_tokens;
  DROP POLICY IF EXISTS "push_tokens_anon_all" ON public.push_tokens;

  CREATE POLICY "push_tokens_anon_all" ON public.push_tokens
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

  -- تنظيف صفوف التشخيص التجريبية (توكنات وهمية أُنشئت أثناء الفحص)
  DELETE FROM public.push_tokens WHERE token LIKE 'zz-diag%';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_key ON public.push_tokens (token);

-- ---------------------------------------------------------------------------
-- 2) web_push_subscriptions — نفس المعالجة
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.web_push_subscriptions') IS NULL THEN
    RAISE WARNING 'web_push_subscriptions غير موجود — تخطي';
    RETURN;
  END IF;

  ALTER TABLE public.web_push_subscriptions ADD COLUMN IF NOT EXISTS is_developer BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.web_push_subscriptions ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT true;
  ALTER TABLE public.web_push_subscriptions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

  ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "anon_select_web_push" ON public.web_push_subscriptions;
  DROP POLICY IF EXISTS "anon_insert_web_push" ON public.web_push_subscriptions;
  DROP POLICY IF EXISTS "anon_update_web_push" ON public.web_push_subscriptions;
  DROP POLICY IF EXISTS "anon_delete_web_push" ON public.web_push_subscriptions;
  DROP POLICY IF EXISTS "web_push_anon_all" ON public.web_push_subscriptions;

  CREATE POLICY "web_push_anon_all" ON public.web_push_subscriptions
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

  -- تنظيف الاشتراكات الوهمية التي أنشأها الفحص
  DELETE FROM public.web_push_subscriptions WHERE endpoint LIKE 'https://diag.invalid/%';
END $$;

-- ---------------------------------------------------------------------------
-- 3) RPC: تسجيل توكن جهاز (يتجاوز RLS — الحل الدائم لمشكلة 42501)
--    يستخدمه التطبيق أولاً في src/lib/push.ts، وإن لم يكن موجوداً يسقط
--    تلقائياً إلى insert عادي (fallback) فلا يتعطل شيء.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token TEXT,
  p_department TEXT DEFAULT NULL,
  p_is_developer BOOLEAN DEFAULT false,
  p_platform TEXT DEFAULT 'android',
  p_alerts_enabled BOOLEAN DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 10 THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE format(
      'INSERT INTO public.push_tokens AS t
         (token, department, is_developer, platform, alerts_enabled, last_seen_at, updated_at)
       VALUES (%L, %L, %L, %L, %L, now(), now())
       ON CONFLICT (token) DO UPDATE
         SET department     = COALESCE(excluded.department, t.department),
             is_developer   = (t.is_developer OR excluded.is_developer),
             platform       = COALESCE(excluded.platform, t.platform),
             alerts_enabled = excluded.alerts_enabled,
             last_seen_at   = now(),
             updated_at     = now()',
      p_token,
      NULLIF(btrim(coalesce(p_department, '')), ''),
      COALESCE(p_is_developer, false),
      COALESCE(p_platform, 'android'),
      COALESCE(p_alerts_enabled, true)
    );
  EXCEPTION WHEN others THEN
    -- قيمة department غير مطابقة لنوع العمود (enum) أو عمود ناقص:
    -- نسجّل التوكن بدون قسم بدل فقدانه بالكامل.
    RAISE WARNING 'register_push_token (with department) failed: %', sqlerrm;
    EXECUTE format(
      'INSERT INTO public.push_tokens AS t
         (token, is_developer, platform, alerts_enabled, last_seen_at, updated_at)
       VALUES (%L, %L, %L, %L, now(), now())
       ON CONFLICT (token) DO UPDATE
         SET is_developer   = (t.is_developer OR excluded.is_developer),
             platform       = COALESCE(excluded.platform, t.platform),
             alerts_enabled = excluded.alerts_enabled,
             last_seen_at   = now(),
             updated_at     = now()',
      p_token,
      COALESCE(p_is_developer, false),
      COALESCE(p_platform, 'android'),
      COALESCE(p_alerts_enabled, true)
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: تسجيل اشتراك Web Push (PWA) — نفس المنطق
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_web_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_department TEXT DEFAULT NULL,
  p_is_developer BOOLEAN DEFAULT false,
  p_alerts_enabled BOOLEAN DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_endpoint IS NULL OR p_endpoint = '' OR p_p256dh IS NULL OR p_auth IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE format(
      'INSERT INTO public.web_push_subscriptions AS t
         (endpoint, p256dh, auth, department, is_developer, alerts_enabled, last_seen_at)
       VALUES (%L, %L, %L, %L, %L, %L, now())
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh         = excluded.p256dh,
             auth           = excluded.auth,
             department     = COALESCE(excluded.department, t.department),
             is_developer   = (t.is_developer OR excluded.is_developer),
             alerts_enabled = excluded.alerts_enabled,
             last_seen_at   = now()',
      p_endpoint, p_p256dh, p_auth,
      NULLIF(btrim(coalesce(p_department, '')), ''),
      COALESCE(p_is_developer, false),
      COALESCE(p_alerts_enabled, true)
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'register_web_push_subscription failed: %', sqlerrm;
    EXECUTE format(
      'INSERT INTO public.web_push_subscriptions AS t
         (endpoint, p256dh, auth, is_developer, alerts_enabled, last_seen_at)
       VALUES (%L, %L, %L, %L, %L, now())
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh         = excluded.p256dh,
             auth           = excluded.auth,
             is_developer   = (t.is_developer OR excluded.is_developer),
             alerts_enabled = excluded.alerts_enabled,
             last_seen_at   = now()',
      p_endpoint, p_p256dh, p_auth,
      COALESCE(p_is_developer, false),
      COALESCE(p_alerts_enabled, true)
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.register_web_push_subscription(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_web_push_subscription(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) pg_net — الإضافة التي تنفّذ HTTP من داخل قاعدة البيانات
--    (إن كانت مثبتة مسبقاً لا يحدث شيء).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'تعذّر تثبيت pg_net (%) — فعّلها من Database → Extensions', sqlerrm;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 6) دالة الإرسال (Trigger → Edge Function push-notify)
--    لا تُفشل الكتابة الأصلية أبداً: كل الاستثناءات ممسوكة.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_push_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_key    TEXT;
  v_secret TEXT;
  v_body   JSONB;
  v_status BIGINT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'push_notify_url'    LIMIT 1;
    SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key'  LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'dispatch_push_webhook: vault lookup failed: %', sqlerrm;
    RETURN NULL;
  END;

  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING 'dispatch_push_webhook: push_notify_url غير مضبوط في Vault — لن يُرسل أي إشعار';
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_body := jsonb_build_object(
      'type', TG_OP, 'table', TG_TABLE_NAME,
      'record', to_jsonb(NEW), 'old_record', to_jsonb(OLD)
    );
  ELSE
    v_body := jsonb_build_object(
      'type', TG_OP, 'table', TG_TABLE_NAME, 'record', to_jsonb(NEW)
    );
  END IF;

  BEGIN
    SELECT net.http_post(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'Authorization',   'Bearer ' || COALESCE(v_key, ''),
        'apikey',          COALESCE(v_key, ''),
        'x-webhook-secret', COALESCE(v_secret, '')
      ),
      timeout_milliseconds := 8000
    ) INTO v_status;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'dispatch_push_webhook: net.http_post failed: %', sqlerrm;
  END;

  RETURN NULL;
END;
$$;

-- مشغلات الإرسال على الجداول التي يدعمها push-notify
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications', 'lectures', 'assignments', 'exams', 'reference_materials', 'registrations']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'push_dispatch_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dispatch_push_webhook()',
      'push_dispatch_' || t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7) أسرار Vault (المصدر الذي تقرأه الدالة أعلاه)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('vault.secrets') IS NULL THEN
    RAISE WARNING 'Vault غير مثبت — أضف الأسرار يدوياً من لوحة Supabase';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'push_notify_url') THEN
    PERFORM vault.create_secret(
      'https://wulycdwgvpriptzubazi.supabase.co/functions/v1/push-notify',
      'push_notify_url',
      'رابط دالة إرسال الإشعارات'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_anon_key') THEN
    PERFORM vault.create_secret(
      'sb_publishable_JmjBwfWyG6Wjr76ZCwmkEw_ZnrZREGc',
      'supabase_anon_key',
      'مفتاح النشر لبوابة الدوال'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'push_webhook_secret') THEN
    -- لا سرّ مكتوب في الكود إطلاقاً: يُولَّد عشوائياً ويبقى داخل Vault وحده،
    -- وتقرأه الدالة عبر public.push_webhook_secret() بصلاحية service_role.
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_webhook_secret',
      'سر ويبهوك عشوائي لـ push-notify'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8) push_diag(): تشخيص سريع — استدعِه من SQL Editor أو من التطبيق
--    select public.push_diag();
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_diag()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens_total   BIGINT := 0;
  v_tokens_enabled BIGINT := 0;
  v_tokens_dev     BIGINT := 0;
  v_tokens_recent  BIGINT := 0;
  v_web_total      BIGINT := 0;
  v_web_enabled    BIGINT := 0;
  v_triggers       JSONB  := '[]'::jsonb;
  v_vault          JSONB  := '{}'::jsonb;
  v_pub            JSONB  := '[]'::jsonb;
BEGIN
  IF to_regclass('public.push_tokens') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.push_tokens' INTO v_tokens_total;
    EXECUTE 'SELECT count(*) FROM public.push_tokens WHERE alerts_enabled' INTO v_tokens_enabled;
    EXECUTE 'SELECT count(*) FROM public.push_tokens WHERE is_developer' INTO v_tokens_dev;
    EXECUTE 'SELECT count(*) FROM public.push_tokens WHERE last_seen_at > now() - interval ''7 days''' INTO v_tokens_recent;
  END IF;

  IF to_regclass('public.web_push_subscriptions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.web_push_subscriptions' INTO v_web_total;
    EXECUTE 'SELECT count(*) FROM public.web_push_subscriptions WHERE alerts_enabled' INTO v_web_enabled;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('trigger', tgname, 'table', c.relname, 'enabled', tgenabled)), '[]'::jsonb)
    INTO v_triggers
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE tg.tgname LIKE 'push_dispatch_%' AND NOT tg.tgisinternal;

  BEGIN
    v_vault := jsonb_build_object(
      'has_push_notify_url',   EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'push_notify_url'),
      'has_anon_key',          EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_anon_key'),
      'has_webhook_secret',    EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'push_webhook_secret')
    );
  EXCEPTION WHEN others THEN
    v_vault := jsonb_build_object('error', sqlerrm);
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(tablename), '[]'::jsonb)
      INTO v_pub
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND tablename IN ('notifications','lectures','assignments','exams','reference_materials','study_tasks','registrations','feedback_messages');
  EXCEPTION WHEN others THEN
    v_pub := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'push_tokens_total',      v_tokens_total,
    'push_tokens_enabled',    v_tokens_enabled,
    'push_tokens_developer',  v_tokens_dev,
    'push_tokens_last_7d',    v_tokens_recent,
    'web_push_total',         v_web_total,
    'web_push_enabled',       v_web_enabled,
    'push_triggers',          v_triggers,
    'vault',                  v_vault,
    'realtime_tables',        v_pub,
    'checked_at',             now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.push_diag() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_diag() TO anon, authenticated;

-- ============================================================================
-- بعد تشغيل هذا الملف (خطوات لازمة مرة واحدة):
--
-- 1) تأكد من نشر دالة push-notify بالنسخة المصحّحة:
--      npx supabase functions deploy push-notify --project-ref wulycdwgvpriptzubazi --no-verify-jwt
--
-- 2) أسرار الدالة (تم ضبطها بالفعل عبر CLI في 23 أكتوبر 2026):
--      FIREBASE_SERVICE_ACCOUNT        = JSON مفتاح حساب الخدمة (وليس google-services.json)
--      WEBPUSH_VAPID_PRIVATE_KEY       = المفتاح الخاص VAPID بصيغة PKCS8 base64
--                                        (ناتج scripts/gen-vapid-keys.mjs — تم تدويره)
--      WEBHOOK_SECRET                  = (مهجور — السرّ الآن من Vault عبر
--                                         public.push_webhook_secret؛ لا تضبطه
--                                         ولا تكتب قيمته في الكود)
--    للتحقق أن المفتاح الخاص يطابق العام المُعلن، أرسل أي طلب للدالة
--    وانظر في الرد: "vapidKeyMatchesPublic": true  (يجب أن تكون true)
--
-- 3) تحقّق بعدها:
--      select public.push_diag();
--    ثم أضف محاضرة من التطبيق واختبر وصول الإشعار والتطبيق مغلق.
-- ============================================================================
