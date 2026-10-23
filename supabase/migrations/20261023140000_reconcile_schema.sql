-- ============================================================================
-- مصالحة مخطط القاعدة مع الإنتاج — 23 أكتوبر 2026
-- ============================================================================
-- المشكلة المقيسة:
--   الدوال الحيّة (verify_password / set_password / progress_session_open /
--   password_status) تستدعي public.app_password_hash(p_phone, p_password)
--   لكن هذه الدالة **ليست في أي ملف هجرة** — أُنشئت يدوياً في لوحة Supabase.
--   أي إعادة بناء للقاعدة من الملفات تنكسر عندها (كل تسجيل دخول يفشل بصمت).
--   كذلك user_passwords و auth_throttle غير معرّفتين في الملفات.
--
-- ماذا يفعل هذا الملف:
--   1) يضمن امتداد pgcrypto (للتجزئة).
--   2) ينشئ user_passwords و auth_throttle **فقط إن كانتا غائبتين**
--      (CREATE TABLE IF NOT EXISTS ⇒ لا يمسّ البيانات الحيّة إطلاقاً).
--   3) ينشئ app_password_hash **فقط إن كانت غائبة**، وإن وُجدت لا يلمسها
--      بل **يقارن ناتجها** بالصيغة المعروفة ويطلق تحذيراً صريحاً عند الاختلاف.
--   4) يضيف RPCين لتعويض ما أُغلق بقصد في ملف إغلاق الجداول:
--        • unregister_push_token(token)  → حذف صف واحد بمفتاحه
--        • unregister_web_push(endpoint) → حذف اشتراك واحد بمفتاحه
--      السبب المقيس: PostgREST يرفض DELETE/UPDATE **بفلتر** على جدول لا يملك
--      عليه العميل صلاحية SELECT (401 / 42501)، وهو ما يحدث الآن بالتصميم.
--      هاتان الدالتان SECURITY DEFINER ⇒ تعيدان القدرة على إلغاء تسجيل جهاز
--      محظور دون إعادة فتح القراءة.
--   5) يحذف صف الاختبار probe-lock-2026 الذي زرعته أثناء القياس.
--
-- آمن للتكرار (idempotent) — شغّله أكثر من مرة. التراجع في نهاية الملف.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) امتداد التجزئة (Supabase يضعه في schema extensions)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2) الجداول الغائبة عن ملفات الهجرة (لا تُنشأ إن كانت موجودة)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_passwords (
  phone                TEXT        PRIMARY KEY,
  password_hash        TEXT        NOT NULL,
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_passwords ENABLE ROW LEVEL SECURITY;
-- لا وصول مباشر لأي دور عميل: كل المنطق عبر RPC (SECURITY DEFINER).
REVOKE ALL ON TABLE public.user_passwords FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.auth_throttle (
  scope        TEXT        NOT NULL,
  identifier   TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, identifier)
);

ALTER TABLE public.auth_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_throttle FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) app_password_hash — تُنشأ فقط إن كانت غائبة
--    الصيغة المطابقة لـ hashPassword() في src/lib/api.ts:
--      SHA-256( phone + '::' + password )  → hex صغير (64 حرفاً)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_exists   BOOLEAN;
  v_matches  BOOLEAN;
BEGIN
  -- pgcrypto قد يكون في extensions أو public حسب المشروع — نغطّي الحالتين.
  PERFORM set_config('search_path', 'public, extensions', true);

  -- الكشف بالنوع لا بالاسم: لو كانت معرّفة في الإنتاج بأسماء وسائط مختلفة
  -- لما صحّت المقارنة النصية، ولمحاولة الإنشاء أن تفشل بـ«already exists».
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'app_password_hash'
       AND p.pronargs = 2
       AND p.prorettype = 'text'::regtype
  ) INTO v_exists;

  IF NOT v_exists THEN
    -- بلغة plpgsql لا sql: الدالة بلغة SQL تُحلّ أسماء crypt/digest وقت
    -- الإنشاء بـsearch_path الجلسة (وقد لا يحوي extensions). بلغة plpgsql
    -- يُحلّ الاسم وقت التنفيذ عبر search_path المثبَّت أدناه ⇒ يعمل في الحالتين.
    EXECUTE $fn$
      CREATE FUNCTION public.app_password_hash(p_phone TEXT, p_password TEXT)
      RETURNS TEXT
      LANGUAGE plpgsql
      IMMUTABLE
      SET search_path = public, extensions
      AS $body$
      BEGIN
        RETURN encode(
                 digest(COALESCE(p_phone, '') || '::' || COALESCE(p_password, ''), 'sha256'),
                 'hex'
               );
      END;
      $body$;
    $fn$;
    REVOKE ALL ON FUNCTION public.app_password_hash(TEXT, TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.app_password_hash(TEXT, TEXT) FROM anon, authenticated;
    RAISE NOTICE 'app_password_hash: أُنشئت الآن (لم تكن موجودة في المخطط)';
  ELSE
    -- موجودة (نسخة الإنتاج) — لا نلمسها، لكن نتحقّق من تطابق ناتجها.
    BEGIN
      SELECT public.app_password_hash('0123456789', 'probe') =
             encode(digest('0123456789::probe', 'sha256'), 'hex')
        INTO v_matches;
    EXCEPTION WHEN others THEN
      v_matches := FALSE;
    END;

    IF v_matches THEN
      RAISE NOTICE 'app_password_hash: موجودة وتطابق SHA-256(phone::password) ✅';
    ELSE
      RAISE WARNING 'app_password_hash موجودة لكن ناتجها لا يطابق SHA-256(phone::password) — لا تلمسها، وأبلغ المطوّر قبل أي تغيير على الدوال.';
    END IF;
  END IF;
END $$;

-- سحب صلاحية التنفيذ عن app_password_hash **دائماً** (سواء أُنشئت الآن أم كانت
-- موجودة سابقاً في الإنتاج بلا تقييد): القياس أثبت أنها كانت تُستدعى من anon
-- وتعيد الهاش. لا تحسب أي دالة عميل تحتاجها: كلها SECURITY DEFINER تعمل بصلاحية
-- المالك، وسحب anon لا يمسّها. التنفيذ ديناميكي لأن وسائط النسخة الحيّة قد تكون
-- varchar مثلاً، فيفشل REVOKE الثابت بـ«function does not exist».
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('app_password_hash', 'password_hash_make', 'password_hash_check')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC', r.nspname, r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM anon, authenticated', r.nspname, r.proname, r.args);
    RAISE NOTICE 'سُحبت صلاحية التنفيذ: %.%(%)', r.nspname, r.proname, r.args;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 4) تعويض DELETE/UPDATE بفلتر (ممنوع بعد إغلاق SELECT)
--    أُغلق الوصول لأن أي قراءة كانت تسرّب التوكنات؛ لكن الحذف بفلتر يحتاج
--    SELECT أيضاً في PostgREST ⇒ صار «إلغاء تسجيل الجهاز» معطّلاً.
--    الحل: دالة SECURITY DEFINER تحذف صفاً واحداً بمفتاحه بالضبط.
--    ⚠️ مخاطرة مقبولة ومحدودة: من يعرف توكن بعينه (تسرّب قبل الإغلاق) يستطيع
--       حذفه ⇒ تعطيل إشعارات ذلك الجهاز فقط. لا توجد قراءة لاستخراج التوكنات،
--       والتوكن عشوائي طويل، والأثر أقصاه «لا إشعارات» لا وصول لبيانات.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_input');
  END IF;

  DELETE FROM public.push_tokens WHERE token = left(p_token, 512);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'removed', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_push_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.unregister_web_push(p_endpoint TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_endpoint IS NULL OR length(btrim(p_endpoint)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_input');
  END IF;

  DELETE FROM public.web_push_subscriptions WHERE endpoint = left(p_endpoint, 2048);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'removed', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_web_push(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unregister_web_push(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) تنظيف صف الاختبار الذي زرعته أثناء القياس
-- ---------------------------------------------------------------------------
DELETE FROM public.push_tokens WHERE token = 'probe-lock-2026';

-- ---------------------------------------------------------------------------
-- 6) تحقّق فوري (اقرأ Messages بعد التنفيذ)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ap  BOOLEAN := EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_password_hash'
  );
  v_up  BOOLEAN := to_regclass('public.user_passwords') IS NOT NULL;
  v_at  BOOLEAN := to_regclass('public.auth_throttle') IS NOT NULL;
  v_up_grant BOOLEAN := has_table_privilege('anon', 'public.user_passwords', 'SELECT');
  v_rows BIGINT := 0;
  v_legacy BIGINT := 0;
BEGIN
  IF v_up THEN
    EXECUTE 'SELECT count(*) FROM public.user_passwords' INTO v_rows;
    EXECUTE $q$SELECT count(*) FROM public.user_passwords
               WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%'$q$
      INTO v_legacy;
  END IF;

  RAISE NOTICE 'pgcrypto: ok · user_passwords=% · auth_throttle=% · app_password_hash=%',
    v_up, v_at, v_ap;
  RAISE NOTICE 'user_passwords: صفوف=% · هاش قديم (SHA-256)=% · SELECT لـ anon=% (يجب false)',
    v_rows, v_legacy, v_up_grant;
  RAISE NOTICE 'unregister_push_token و unregister_web_push: جاهزتان (تُغلقان ثغرة الفلتر)';
END $$;

COMMIT;

-- ============================================================================
-- التحقّق بعد التنفيذ (من الجهاز، بمفتاح anon):
--   POST /rest/v1/rpc/unregister_push_token {"p_token":"x"}   → 200 {"ok":true,...}
--   POST /rest/v1/rpc/unregister_web_push   {"p_endpoint":"x"} → 200 {"ok":true,...}
--   GET  /rest/v1/push_tokens?select=*                         → 401 (كما هو) ✅
-- ============================================================================
-- التراجع (إن أردت إزالة الدالتين فقط — لا يمسّ البيانات):
--   DROP FUNCTION IF EXISTS public.unregister_push_token(TEXT);
--   DROP FUNCTION IF EXISTS public.unregister_web_push(TEXT);
-- ملاحظة: لا تحذف app_password_hash — الدوال الحيّة تعتمد عليها.
-- ============================================================================
