-- ============================================================
-- 20261024090000_push_notifications_hardening.sql
-- إغلاق ثغرتين أمنيتين في نظام الإشعارات (N1 + N2)
-- ------------------------------------------------------------
-- الثغرة N2 (تسريب بيانات الطلاب): صفة «جهاز مطوّر» كانت تُقبل من العميل.
--   المسار 1: دالة الحافة push-notify تقرأ body.is_developer === true وتكتبه
--             بمفتاح service role (يتجاوز RLS).
--   المسار 2: دوال register_push_token / register_web_push_subscription تقبل
--             p_is_developer وتُثبّتها: is_developer = (t OR excluded).
--   المسار 3: سياسة الكتابة المباشرة (WITH CHECK true) على الجدولين.
--   النتيجة: أي طالب يملك المفتاح العام (وهو مضمَّن داخل التطبيق) يستطيع
--   تسمية جهازه «مطوّراً» ⇒ يصله إشعار كل تسجيل جديد: الاسم + رقم الهاتف.
--
--   الحل هنا: حارس واحد على مستوى القاعدة (BEFORE INSERT OR UPDATE) يقرّر
--   بدلاً من كل المسارات: إذا طلب الصف is_developer = TRUE بلا توكين مطوّر
--   صالح (هيدر x-dev-token يمرّ على public.dev_token_ok()) ⇒ يُسقَط إلى FALSE.
--   ⇒ يغلق الثلاثة معاً، وأي مسار كتابة يُضاف مستقبلاً يرث الحماية تلقائياً.
--
-- الثغرة N1 (سرّ الويبهوك): لا مكان واحد موثوقاً يقرأ منه push-notify السرّ،
--   وغياب WEBHOOK_SECRET كان يجعل الفحص يُتخطّى كلياً (fail-open).
--   الحل: public.push_webhook_secret() تقرأ السرّ من Vault بصلاحية
--   service_role وحدها، وتُهيّئ للدالة أن ترفض الطلب عند غياب السرّ.
--   + تدوير القيمة المسرَّبة نفسها في القسم (1.ب) من هذا الملف — فتنفيذ ملف
--     واحد يجعل النظام آمناً وعاملاً معاً، بأي ترتيب نشر.
--
-- هذا الملف لا يغيّر أي سلوك ظاهر للطلاب: القراءة والإشعارات كما هي،
-- وتوكنات الأجهزة الحالية تبقى مسجّلة.
-- قابل لإعادة التنفيذ بأمان (idempotent).
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1) السرّ المشترك للويبهوك: مصدر واحد من Vault (service_role فقط)
-- ---------------------------------------------------------------------------
-- لماذا SECURITY DEFINER؟ جدول vault.decrypted_secrets غير مقروء للدور anon
-- ولا لauthenticated. الدالة تعمل بصلاحية مالكها (postgres) وتُرجع السرّ
-- لدور الخدمة فقط — أي أن التطبيق والطلاب لا يستطيعون قراءته أبداً.
CREATE OR REPLACE FUNCTION public.push_webhook_secret()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_secret'
   LIMIT 1;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.push_webhook_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_webhook_secret() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_webhook_secret() TO service_role;

COMMENT ON FUNCTION public.push_webhook_secret()
  IS 'سرّ x-webhook-secret لـ push-notify (Vault). service_role فقط — لا يُمنح أبداً لـ anon/authenticated.';


-- ---------------------------------------------------------------------------
-- 1.ب) تدوير السرّ المسرَّب (N1) — داخل نفس الملف بقصد
-- ---------------------------------------------------------------------------
-- لماذا هنا وليس في ملف منفصل؟
--   ملف التدوير المنفصل كان يفرض ترتيباً إلزامياً: (هجرة الحارس) ← (نشر
--   الدالة) ← (التدوير). أي خطأ في الترتيب (نشر الدالة قبل الهجرة) يجعل
--   push-notify تفشل مغلقة ⇒ **تتوقف كل الإشعارات**. ودمج التدوير هنا يجعل
--   الترتيب آمناً في كل الحالات:
--     • هجرة ثم دالة  : الدالة القديمة لا تفحص السرّ (fail-open) ⇒ تعمل،
--                       ثم الجديدة تقرأ نفس القيمة من Vault ⇒ تعمل.
--     • دالة ثم هجرة  : الدالة الجديدة ترفض 503 حتى تُنفَّذ الهجرة ⇒ لا ثغرة،
--                       وتعود الإشعارات فوراً بعد تنفيذها (بلا إعادة نشر).
--   كما يزول تأخير الدقيقة (cache 60s) الذي كان يُسقط إشعارات بعد التدوير،
--   لأن المشغّل والدالة يقرآن نفس صف Vault في كل نداء.
--
-- القيمة القديمة mohanndes-push-webhook-2026 مكتوبة حرفياً في مستودع الكود،
-- فأي قارئ للمستودع كان يستطيع إرسال إشعارات لكل الأجهزة. نستبدلها بـ 32 بايت
-- عشوائية (64 خانة hex) ولا نطبعها في أي سجلّ.
--
-- idempotent: لا يُدوَّر سرّ سليم (طوله 64) مرة أخرى عند إعادة تنفيذ الملف،
-- فلا تُفقد إشعارات ولا تظهر 401 متقطعة عند تكرار الهجرة.
DO $$
DECLARE
  v_id     UUID;
  v_current TEXT;
  v_new    TEXT;
BEGIN
  IF to_regclass('vault.secrets') IS NULL THEN
    RAISE NOTICE 'Vault غير مثبّت — تخطّي تدوير السرّ (لن تعمل push-notify بلا سرّ)';
    RETURN;
  END IF;

  SELECT id, decrypted_secret INTO v_id, v_current
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_secret'
   LIMIT 1;

  -- سرّ سليم مسبقاً (64 خانة hex) ⇒ لا نلمسه أبداً.
  IF v_current IS NOT NULL AND v_current ~ '^[0-9a-f]{64}$' THEN
    RAISE NOTICE 'push_webhook_secret سليم مسبقاً — لا تدوير';
    RETURN;
  END IF;

  BEGIN
    v_new := encode(extensions.gen_random_bytes(32), 'hex');
  EXCEPTION WHEN undefined_function THEN
    v_new := encode(gen_random_bytes(32), 'hex');
  END;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_new, 'push_webhook_secret',
      'سرّ x-webhook-secret لطلبات push-notify');
    RAISE NOTICE 'أُنشئ push_webhook_secret جديد في Vault';
  ELSE
    BEGIN
      PERFORM vault.update_secret(v_id, v_new);
      RAISE NOTICE 'تم تدوير push_webhook_secret المسرَّب في Vault';
    EXCEPTION WHEN undefined_function THEN
      -- نسخ Vault الأقدم لا توفّر update_secret
      DELETE FROM vault.secrets WHERE id = v_id;
      PERFORM vault.create_secret(v_new, 'push_webhook_secret',
        'سرّ x-webhook-secret لطلبات push-notify');
      RAISE NOTICE 'أُعيد إنشاء push_webhook_secret (نسخة Vault بلا update_secret)';
    END;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2) حارس صفة المطوّر على أجهزة الإشعارات
-- ---------------------------------------------------------------------------
-- يعمل قبل أي INSERT/UPDATE على push_tokens و web_push_subscriptions،
-- بما في ذلك: دالة الحافة (service role)، الـ RPC (SECURITY DEFINER)،
-- والكتابة المباشرة من PostgREST. لا يمكن تجاوزه إلا بتوكين مطوّر صالح.
CREATE OR REPLACE FUNCTION public.push_guard_dev_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  -- الصفوف العادية (is_developer = FALSE/NULL) تمرّ بلا أي كلفة.
  IF NEW.is_developer IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_ok := public.dev_token_ok();
  EXCEPTION WHEN others THEN
    -- غياب الهيدر أو أي خطأ داخلي ⇒ لا ثقة (fail-closed).
    v_ok := FALSE;
  END;

  IF NOT v_ok THEN
    NEW.is_developer := FALSE;
    RAISE WARNING
      'push_guard_dev_flag: أُسقط is_developer على %.% — لا يوجد توكين مطوّر صالح',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.push_guard_dev_flag() FROM PUBLIC;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['push_tokens', 'web_push_subscriptions']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'push_guard_dev_flag: الجدول public.% غير موجود — تخطٍّ', t;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'is_developer'
    ) THEN
      RAISE NOTICE 'push_guard_dev_flag: العمود is_developer غير موجود على public.% — تخطٍّ', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'push_guard_dev_flag_trigger', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.push_guard_dev_flag()',
      'push_guard_dev_flag_trigger', t
    );
    RAISE NOTICE 'push_guard_dev_flag: مثبَّت على public.%', t;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) تصفير أي صفة مطوّر مُدّعاة سابقاً (مرة واحدة)
-- ---------------------------------------------------------------------------
-- الحارس أعلاه يعمل على هذه التحديثات أيضاً، لكنها كلها FALSE فلا يفعل شيئاً.
UPDATE public.push_tokens            SET is_developer = FALSE WHERE is_developer;
UPDATE public.web_push_subscriptions SET is_developer = FALSE WHERE is_developer;

-- ---------------------------------------------------------------------------
-- 4) تنظيف صفوف الفحص الأمني (توكنات صورية أُنشئت أثناء التحقق من الثغرة)
-- ---------------------------------------------------------------------------
-- توكنات FCM الحقيقية لا تبدأ بـ PROBE_؛ هذه صفوف تشخيص مؤقتة.
DELETE FROM public.push_tokens WHERE token LIKE 'PROBE\_%';

-- ---------------------------------------------------------------------------
-- 5) تشخيص الحالة الأمنية بأمر واحد (لا يكشف أي سرّ — قيم منطقية وعدّادات فقط)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_security_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_triggers    INT := 0;
  v_rpc         BOOLEAN := FALSE;
  v_readable    BOOLEAN := FALSE;
  v_vault       BOOLEAN := FALSE;
  v_devices     INT := 0;
  v_devices_dev INT := 0;
  v_devices_off INT := 0;
  v_web_dev     INT := 0;
  v_warn        JSONB := '[]'::jsonb;
BEGIN
  SELECT count(*) INTO v_triggers
    FROM pg_trigger
   WHERE tgname = 'push_guard_dev_flag_trigger' AND NOT tgisinternal;

  v_rpc := to_regprocedure('public.push_webhook_secret()') IS NOT NULL;

  -- كل قراءة حسّاسة داخل حارس: التشخيص يجب ألا يفشل أبداً (لو غاب Vault أو
  -- تغيّرت صلاحية الدالة) — وإلا صار أمر التحقق نفسه خطأً.
  BEGIN
    v_readable := public.push_webhook_secret() IS NOT NULL;
  EXCEPTION WHEN others THEN
    v_readable := FALSE;
  END;

  BEGIN
    v_vault := EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'push_webhook_secret');
  EXCEPTION WHEN others THEN
    v_vault := FALSE;
  END;

  SELECT count(*),
         count(*) FILTER (WHERE is_developer),
         count(*) FILTER (WHERE NOT alerts_enabled)
    INTO v_devices, v_devices_dev, v_devices_off
    FROM public.push_tokens;

  SELECT count(*) INTO v_web_dev
    FROM public.web_push_subscriptions
   WHERE is_developer;

  -- تحذيرات عربية جاهزة: أهم سببين لظهور النظام «ميتاً» رغم سلامة كل شيء.
  IF NOT v_readable THEN
    v_warn := v_warn || to_jsonb(
      'السرّ غير مقروء من Vault: نفّذ هذه الهجرة كاملة ثم أعد نشر الدالة push-notify'::text);
  END IF;
  IF v_devices_dev = 0 THEN
    v_warn := v_warn || to_jsonb(
      'لا يوجد جهاز مطوّر مسجَّل: إشعارات «تسجيل جديد» و«ملاحظة جديدة» لن تصل إلى الهاتف. سجّل الدخول كمطوّر على الهاتف (نسخة v34 أو أحدث) ثم اضغط «إصلاح الإشعارات» في الإعدادات.'::text);
  END IF;
  IF v_devices_off > 0 THEN
    v_warn := v_warn || to_jsonb(format(
      '%s جهاز أوقف تنبيهات المحتوى (alerts_enabled=false) — لن يصله أي إشعار حتى يُفعّلها صاحبها من الإعدادات.', v_devices_off));
  END IF;

  RETURN jsonb_build_object(
    'dev_guard_triggers', v_triggers,
    'webhook_secret_rpc', v_rpc,
    'webhook_secret_readable', v_readable,
    'vault_secret_present', v_vault,
    'devices_total', v_devices,
    'devices_alerts_off', v_devices_off,
    'devices_developer', v_devices_dev,
    'web_devices_developer', v_web_dev,
    'warnings', v_warn,
    'checked_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.push_security_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_security_status() TO anon, authenticated;

COMMENT ON FUNCTION public.push_security_status()
  IS 'تشخيص حالة الإشعارات: عدّادات وتحذيرات عربية فقط — لا يكشف أي سرّ أو بيانات طالب.';


-- ---------------------------------------------------------------------------
-- 5.ب) حالة جهاز واحد (يستدعيها التطبيق من شاشة الإعدادات)
-- ---------------------------------------------------------------------------
-- لماذا آمنة رغم منحها لـ anon؟ لأنها لا تُرجع أي بيانات طالب: المستدعي يجب
-- أن يعرف توكن جهازه أولاً (سلسلة عشوائية 150+ حرفاً لا تُخمَّن)، والمُرجَع
-- ثلاثة أعلام منطقية فقط: هل الصف موجود، هل التنبيهات مفعّلة، هل الجهاز مطوّر.
-- الفائدة: الطالب/المطوّر يرى سبب عدم وصول الإشعارات بدل التخمين.
CREATE OR REPLACE FUNCTION public.push_device_status(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerts BOOLEAN;
  v_dev    BOOLEAN;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RETURN jsonb_build_object('registered', false, 'alerts_enabled', false, 'is_developer', false);
  END IF;

  SELECT alerts_enabled, is_developer
    INTO v_alerts, v_dev
    FROM public.push_tokens
   WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('registered', false, 'alerts_enabled', false, 'is_developer', false);
  END IF;

  RETURN jsonb_build_object(
    'registered', true,
    'alerts_enabled', COALESCE(v_alerts, false),
    'is_developer', COALESCE(v_dev, false)
  );
END $$;

REVOKE ALL ON FUNCTION public.push_device_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_device_status(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.push_device_status(TEXT)
  IS 'حالة جهاز الإشعارات لصاحب التوكن نفسه: registered / alerts_enabled / is_developer فقط.';

-- ---------------------------------------------------------------------------
-- 6) تحديث ذاكرة PostgREST ليظهر push_webhook_secret فوراً للدالة
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- تحقّق سريع بعد التنفيذ (SQL Editor):
--   SELECT tgname, tgrelid::regclass AS tbl
--     FROM pg_trigger WHERE tgname = 'push_guard_dev_flag_trigger';  -- صفّان
--   SELECT public.push_security_status();
--     المتوقّع: dev_guard_triggers = 2 · webhook_secret_rpc = true ·
--               webhook_secret_readable = true · devices_developer = 0
--     وwarnings تشرح أي خلل متبقٍّ (جهاز مطوّر / أجهزة معطّلة / سرّ).
--   SELECT public.push_device_status('ضع-توكن-جهازك');  -- من التطبيق تلقائياً
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.push_guard_dev_flag()
  IS 'حارس صفة المطوّر على أجهزة الإشعارات: يُسقط is_developer إن لم يكن التوكين صالحاً.';
