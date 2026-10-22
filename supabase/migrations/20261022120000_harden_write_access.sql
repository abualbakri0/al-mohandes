-- ============================================================
-- 20261022120000_harden_write_access.sql
-- تقوية الكتابة على قاعدة البيانات + تقييد التخمين
-- ------------------------------------------------------------
-- المشكلة قبل هذا الملف:
--   المفتاح العام (anon) مضمَّن في التطبيق وفي المستودع. سياسات RLS كانت
--   WITH CHECK (true) للكتابة، أي أن أي شخص يملك المفتاح يستطيع حذف/تعديل
--   المحاضرات والامتحانات والإشعارات والمراجع وجهات الاتصال.
--
-- بعد هذا الملف:
--   1) القراءة كما هي تماماً → الطلاب لا يتأثرون إطلاقاً.
--   2) كل INSERT/UPDATE/DELETE على محتوى التطبيق يتطلّب توكناً موقّعاً من
--      المطوّر (ناتج verify_developer_code) يُرسَل في الهيدر x-dev-token،
--      وتتحقق منه public.dev_token_ok() داخل RLS.
--   3) تسجيل الطالب وإرسال الملاحظة يبقيان مفتوحين (وظائف الطلاب) مع منع
--      اعتماد التسجيل الذاتي (is_approved) من العميل.
--   4) حدّ لمحاولات تخمين رمز المطوّر وكلمات المرور (rate limit).
--
-- لا يمسّ هذا الملف إطلاقاً:
--   push_tokens / web_push_subscriptions / bot_kv / user_*_progress /
--   student_keys / دوال الإرسال والإشعارات الفورية.
--
-- قابل لإعادة التنفيذ بأمان (idempotent).
-- ============================================================


-- ============================================================
-- 1) التحقق من توكين المطوّر المارّ في الهيدر
-- ============================================================
-- PostgREST يضع كل هيدرات الطلب في GUC اسمه request.headers، فنقرأ منه
-- x-dev-token. نفس صيغة HMAC المستخدمة في verify_dev_token (لا تغيير).
CREATE OR REPLACE FUNCTION public.dev_token_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token  TEXT;
  v_exp    BIGINT;
  v_mac    TEXT;
  v_secret TEXT;
BEGIN
  BEGIN
    v_token := (current_setting('request.headers', true)::jsonb ->> 'x-dev-token');
  EXCEPTION WHEN OTHERS THEN
    v_token := NULL;
  END;

  IF v_token IS NULL OR v_token = '' OR v_token !~ '^[0-9]+\.[0-9a-f]+$' THEN
    RETURN FALSE;
  END IF;

  v_exp := split_part(v_token, '.', 1)::BIGINT;
  IF v_exp < (extract(epoch FROM now()))::BIGINT THEN
    RETURN FALSE;  -- توكين منتهي (30 يوماً) → يُطلب رمز المطوّر مجدداً
  END IF;

  SELECT s.dev_password INTO v_secret FROM app_settings s LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN FALSE;
  END IF;

  v_mac := split_part(v_token, '.', 2);
  RETURN v_mac = encode(hmac(convert_to(v_exp::TEXT || '|dev-grant', 'UTF8'),
                             convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.dev_token_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dev_token_ok() TO anon, authenticated;


-- ============================================================
-- 2) المحتوى الذي يكتبه المطوّر فقط
-- ============================================================
-- نسقط *كل* سياسة كتابة قديمة (بأي اسم) حتى لا تبقى ثغرة من هجرة سابقة،
-- ثم ننشئ سياسات الكتابة الجديدة المشروطة بالتوكين.
DO $$
DECLARE
  v_tables TEXT[] := ARRAY[
    'lectures', 'assignments', 'study_tasks',
    'exams', 'notifications', 'reference_materials'
  ];
  v_table  TEXT;
  v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = v_table
         AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated '
      'WITH CHECK ((SELECT public.dev_token_ok()))',
      'dev_insert_' || v_table, v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO anon, authenticated '
      'USING ((SELECT public.dev_token_ok())) '
      'WITH CHECK ((SELECT public.dev_token_ok()))',
      'dev_update_' || v_table, v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO anon, authenticated '
      'USING ((SELECT public.dev_token_ok()))',
      'dev_delete_' || v_table, v_table);
  END LOOP;
END $$;


-- ============================================================
-- 3) التسجيل والملاحظات: وظائف الطالب تبقى مفتوحة، والتعديل للمطوّر فقط
-- ============================================================
DO $$
DECLARE
  v_tables TEXT[] := ARRAY['registrations', 'feedback_messages'];
  v_table  TEXT;
  v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = v_table
         AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;
END $$;

-- تسجيل طالب جديد: مسموح للجميع، لكن لا يمكن تسجيل صف «معتمَد مسبقاً»
-- (كان الطالب يستطيع إرسال is_approved=true وتجاوز بوابة الاعتماد).
CREATE POLICY "public_insert_registrations" ON public.registrations
  FOR INSERT TO anon, authenticated
  WITH CHECK (COALESCE(is_approved, false) = false);

CREATE POLICY "dev_update_registrations" ON public.registrations
  FOR UPDATE TO anon, authenticated
  USING ((SELECT public.dev_token_ok()))
  WITH CHECK ((SELECT public.dev_token_ok()));

CREATE POLICY "dev_delete_registrations" ON public.registrations
  FOR DELETE TO anon, authenticated
  USING ((SELECT public.dev_token_ok()));

-- ملاحظات الطلاب: الإرسال مسموح (وظيفة الطالب)، والحذف/التعليم كمقروء
-- للمطوّر فقط (كان أي شخص يستطيع حذف كل الملاحظات).
CREATE POLICY "public_insert_feedback" ON public.feedback_messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "dev_update_feedback" ON public.feedback_messages
  FOR UPDATE TO anon, authenticated
  USING ((SELECT public.dev_token_ok()))
  WITH CHECK ((SELECT public.dev_token_ok()));

CREATE POLICY "dev_delete_feedback" ON public.feedback_messages
  FOR DELETE TO anon, authenticated
  USING ((SELECT public.dev_token_ok()));


-- ============================================================
-- 4) إعدادات التطبيق: التعديل للمطوّر فقط
-- ============================================================
-- (منح الأعمدة في RUN-THIS-IN-SUPABASE يمنع أصلاً لمس dev_password،
--  وهذا يقفل باقي الأعمدة أيضاً.)
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'app_settings'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.app_settings', v_policy.policyname);
  END LOOP;
END $$;

CREATE POLICY "dev_update_app_settings" ON public.app_settings
  FOR UPDATE TO anon, authenticated
  USING ((SELECT public.dev_token_ok()))
  WITH CHECK ((SELECT public.dev_token_ok()));


-- ============================================================
-- 5) حدّ محاولات التخمين (rate limit)
-- ============================================================
-- قبل هذا القسم: verify_developer_code و verify_password و set_password
-- و progress_session_open و change_dev_code كانت مكشوفة لـ anon بلا حدّ،
-- أي تخمين غير محدود لرمز المطوّر (ثم الحصول على توكين صالح) أو لكلمة مرور
-- طالب. الجدول غير متاح لأي دور عميل — تُستدعى الدالة داخلياً فقط.
CREATE TABLE IF NOT EXISTS public.auth_throttle (
  scope        TEXT        NOT NULL,
  identifier   TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, identifier)
);

ALTER TABLE public.auth_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_throttle FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.auth_throttle_hit(
  p_scope      TEXT,
  p_identifier TEXT,
  p_max        INTEGER,
  p_window     INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  INSERT INTO auth_throttle AS t (scope, identifier, window_start, attempts)
  VALUES (p_scope, left(COALESCE(p_identifier, ''), 200), now(), 1)
  ON CONFLICT (scope, identifier) DO UPDATE
    SET attempts     = CASE WHEN t.window_start < now() - p_window THEN 1 ELSE t.attempts + 1 END,
        window_start = CASE WHEN t.window_start < now() - p_window THEN now() ELSE t.window_start END
  RETURNING t.attempts INTO v_attempts;

  -- تنظيف عشوائي نادر للصفوف القديمة (بلا تكلفة على المسار الساخن).
  IF random() < 0.02 THEN
    DELETE FROM auth_throttle WHERE window_start < now() - INTERVAL '1 day';
  END IF;

  RETURN v_attempts <= p_max;  -- TRUE = مسموح
END;
$$;

REVOKE ALL ON FUNCTION public.auth_throttle_hit(TEXT, TEXT, INTEGER, INTERVAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_throttle_hit(TEXT, TEXT, INTEGER, INTERVAL) FROM anon, authenticated;


-- 5/أ) رمز المطوّر: 6 محاولات لكل 15 دقيقة (يُصفَّر عند النجاح).
CREATE OR REPLACE FUNCTION public.verify_developer_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
  v_exp    BIGINT;
BEGIN
  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN '';
  END IF;
  IF NOT public.auth_throttle_hit('dev_code', 'all', 6, INTERVAL '15 minutes') THEN
    RETURN '';
  END IF;
  SELECT s.dev_password INTO v_secret FROM app_settings s LIMIT 1;
  IF v_secret IS NULL OR v_secret IS DISTINCT FROM btrim(p_code) THEN
    RETURN '';
  END IF;
  DELETE FROM auth_throttle WHERE scope = 'dev_code' AND identifier = 'all';
  v_exp := (extract(epoch FROM now() + interval '30 days'))::BIGINT;
  RETURN v_exp::TEXT || '.' ||
         encode(hmac(convert_to(v_exp::TEXT || '|dev-grant', 'UTF8'),
                     convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_developer_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_developer_code(TEXT) TO anon, authenticated;


-- 5/ب) كلمة مرور الطالب: 10 محاولات لكل رقم في 10 دقائق (تُصفَّر عند النجاح).
CREATE OR REPLACE FUNCTION public.verify_password(p_phone TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF p_phone IS NULL OR p_password IS NULL THEN
    RETURN FALSE;
  END IF;
  IF NOT public.auth_throttle_hit('user_password', p_phone, 10, INTERVAL '10 minutes') THEN
    RETURN FALSE;
  END IF;
  SELECT up.password_hash INTO v_hash FROM user_passwords up WHERE up.phone = p_phone;
  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_hash = app_password_hash(p_phone, p_password) THEN
    DELETE FROM auth_throttle WHERE scope = 'user_password' AND identifier = p_phone;
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_password(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_password(TEXT, TEXT) TO anon, authenticated;


-- 5/ج) تعيين كلمة المرور: نفس الحدّ عند طلب كلمة المرور الحالية
--      (كان يمكن تخمين «الحالية» عبر set_password بلا حدّ).
CREATE OR REPLACE FUNCTION public.set_password(
  p_phone       TEXT,
  p_password    TEXT,
  p_must_change BOOLEAN DEFAULT FALSE,
  p_current     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF p_phone IS NULL OR p_password IS NULL OR length(p_password) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_input');
  END IF;

  IF p_current IS NOT NULL
     AND NOT public.auth_throttle_hit('user_password', p_phone, 10, INTERVAL '10 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'too_many_attempts');
  END IF;

  SELECT up.password_hash INTO v_hash FROM user_passwords up WHERE up.phone = p_phone FOR UPDATE;

  -- ⚠️ سدّ ثغرة اختطاف الحساب:
  -- كان استدعاء set_password(phone, أي_كلمة, false, NULL) يستبدل كلمة مرور أي
  -- طالب دون معرفة الحالية (p_current = NULL يعني «بلا تحقق»). الآن:
  --   • مستخدم جديد (لا هاش) → مسموح (تسجيل عادي).
  --   • المطوّر (توكين صالح) → مسموح (إعادة تعيين من شاشة التسجيلات).
  --   • طالب في حالة «يجب تغيير كلمة المرور» → مسموح (تدفّق التطبيق كما هو).
  --   • أي حالة أخرى → مرفوض.
  IF v_hash IS NOT NULL AND p_current IS NULL AND NOT public.dev_token_ok() THEN
    IF NOT COALESCE((
      SELECT up2.must_change_password FROM user_passwords up2
       WHERE up2.phone = p_phone LIMIT 1
    ), FALSE) THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'current_required');
    END IF;
  END IF;

  IF v_hash IS NOT NULL AND p_current IS NOT NULL
     AND v_hash <> app_password_hash(p_phone, p_current) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_current');
  END IF;

  INSERT INTO user_passwords (phone, password_hash, must_change_password, updated_at)
  VALUES (p_phone, app_password_hash(p_phone, p_password), COALESCE(p_must_change, FALSE), now())
  ON CONFLICT (phone) DO UPDATE
    SET password_hash        = EXCLUDED.password_hash,
        must_change_password = EXCLUDED.must_change_password,
        updated_at           = now();

  IF p_current IS NOT NULL THEN
    DELETE FROM auth_throttle WHERE scope = 'user_password' AND identifier = p_phone;
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.set_password(TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_password(TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;



-- 5/د) فتح جلسة التقدّم: كان مساراً بديلاً لتخمين كلمة المرور بلا حدّ.
CREATE OR REPLACE FUNCTION public.progress_session_open(p_phone TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid;
  v_hash TEXT;
  v_key  uuid;
BEGIN
  IF p_phone IS NULL OR p_password IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_input');
  END IF;
  IF NOT public.auth_throttle_hit('user_password', p_phone, 10, INTERVAL '10 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'too_many_attempts');
  END IF;
  -- نفس منطق checkRegistration: أقدم صف عند تكرار الرقم.
  SELECT id INTO v_user FROM registrations WHERE phone = p_phone
   ORDER BY created_at ASC LIMIT 1;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'no_user');
  END IF;
  SELECT up.password_hash INTO v_hash FROM user_passwords up WHERE up.phone = p_phone;
  IF v_hash IS NULL OR v_hash <> app_password_hash(p_phone, p_password) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_password');
  END IF;
  DELETE FROM auth_throttle WHERE scope = 'user_password' AND identifier = p_phone;
  INSERT INTO student_keys (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT progress_key INTO v_key FROM student_keys WHERE user_id = v_user;
  RETURN jsonb_build_object('ok', TRUE, 'user_id', v_user, 'key', v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.progress_session_open(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.progress_session_open(TEXT, TEXT) TO anon, authenticated;


-- 5/هـ) تغيير رمز المطوّر: يشارك نفس دلو المحاولات مع verify_developer_code.
CREATE OR REPLACE FUNCTION public.change_dev_code(p_current TEXT, p_new TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  IF p_current IS NULL OR length(btrim(p_current)) = 0
     OR p_new IS NULL OR length(btrim(p_new)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_input');
  END IF;
  IF length(btrim(p_new)) < 4 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'too_short');
  END IF;
  IF NOT public.auth_throttle_hit('dev_code', 'all', 6, INTERVAL '15 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'too_many_attempts');
  END IF;
  SELECT s.dev_password INTO v_secret FROM app_settings s LIMIT 1;
  IF v_secret IS NULL OR v_secret IS DISTINCT FROM btrim(p_current) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_current');
  END IF;
  -- الكتابة تعمل لأن الدالة SECURITY DEFINER (مالكها يتجاوز RLS).
  UPDATE app_settings SET dev_password = btrim(p_new), updated_at = now();
  DELETE FROM auth_throttle WHERE scope = 'dev_code' AND identifier = 'all';
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.change_dev_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_dev_code(TEXT, TEXT) TO anon, authenticated;


-- ============================================================
-- 6) دلو المراجع (storage) — في ملف منفصل اختياري
-- ============================================================
-- سياسات الرفع/الحذف على storage.objects تحتاج أن تُمرّر خدمة Storage الهيدر
-- x-dev-token إلى قاعدة البيانات، وهذا لا يمكن التأكد منه إلا بتجربة رفع فعلية.
-- لذلك لم نضعها هنا (لا نريد كسر رفع المراجع). لتطبيقها:
--   نفّذ الملف: RUN-THIS-OPTIONAL-harden-storage.sql
-- ثم ارفع PDF تجريبياً؛ وإن فشل، فيه تراجع بسطرين.


-- ============================================================
-- 7) تحقّق سريع بعد التنفيذ (اقرأ النتيجة في نفس نافذة SQL)
-- ============================================================
-- SELECT tablename, policyname, cmd, qual IS NOT NULL AS has_using,
--        with_check IS NOT NULL AS has_check
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('lectures','assignments','study_tasks','exams',
--                      'notifications','reference_materials','registrations',
--                      'feedback_messages','app_settings')
--  ORDER BY tablename, cmd;
--
-- المتوقع: لا توجد أي سياسة كتابة بـ qual/with_check يساوي true،
--          وظهور دوال dev_insert_* / dev_update_* / dev_delete_*.
--
-- ملاحظة: push_tokens و web_push_subscriptions و bot_kv لم تُمسّ إطلاقاً.
-- ============================================================

