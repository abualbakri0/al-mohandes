-- ============================================================================
-- 20261024120000_fix_new_user_login.sql
-- العنوان: «المستخدم الجديد لا يستطيع الدخول» — السبب المقيس والإصلاح
-- ----------------------------------------------------------------------------
-- السبب الجذري (مقيس على القاعدة الحيّة بمفتاح anon، رقم اختبار 700000909):
--
--   1) POST /rpc/register_student  (نفس الرقم، مرّتين)  → 200 + صفّان!
--        {"id":"88c93491-…","name":"DIAG ONE", "created_at":"…:30.597"}
--        {"id":"d1442a5b-…","name":"DIAG TWO", "created_at":"…:31.611"}
--      لا يوجد أي قيد فريد على registrations(phone)، ولا فحص داخل الدالة.
--
--   2) POST /rpc/registration_by_phone                   → يعيد **الأقدم**
--        ORDER BY created_at ASC LIMIT 1   ⇒ الصف الأول (غير المعتمد).
--
--   3) لوحة المطوّر تعرض الصفّين، ويعتمد المطوّر أحدثهما (أول القائمة DESC).
--      والاعتماد كان بـ WHERE id = p_id ⇒ صفّ واحد فقط.
--
--   النتيجة: الطالب يُعتمد في اللوحة، ثم شاشة الدخول تقرأ الصف الأقدم غير
--   المعتمد ⇒ «بانتظار الموافقة» إلى الأبد، ولو أدخل كلمة المرور الصحيحة
--   (كلمة المرور مخزّنة بالرقم، لذا هي صحيحة، لكن الاعتماد ليس كذلك).
--
--   تكرار ثانٍ: إذا فشل set_password بعد إنشاء الصف (شبكة/نسخة قديمة) يصبح
--   الصف «يتيماً»، وكل محاولة تسجيل تالية تُضيف صفاً آخر — مصدر التكرار نفسه.
--
-- الإصلاح (كل ما هنا آمن وقابل لإعادة التنفيذ):
--   ① register_student: صفّ واحد لكل رقم. قفل استشاري على الرقم + إعادة الصف
--      الموجود بدل الإدراج، وتصحيح الاسم/التخصص ما دام لم يُعتمد.
--   ② approve_registration: يعتمد **كل** صفوف الرقم (لا صفّاً واحداً) — يُشفي
--      الحالات المتكرّرة فوراً عند أول ضغطة اعتماد.
--   ③ delete_registration: يحذف كل صفوف الرقم + كلمة مروره + مفاتيح جلساته
--      (صفوف التقدّم تُحذف تلقائياً بON DELETE CASCADE).
--   ④ إصلاح بيانات لمرة واحدة: كل رقم له صفّ معتمد → تُعتمد بقية صفوفه.
--   ⑤ فهرس فريد على registrations(phone) — يُنشأ فقط إن لم يكن هناك تكرار
--      سابق (وإلا يُطبع تنبيه، ولا يُكسر شيء).
--   ⑥ password_status: كانت موجودة في القاعدة فقط (ضمن RUN-THIS-IN-SUPABASE.sql)
--      وغير موجودة في أي هجرة ⇒ إعادة إنشاء مثيل مطابق حتى لا يسقط تنصيب جديد
--      إلى «دخول بالرقم فقط» بصمت.
--   ⑦ password_login_blocked: قراءة حالة حدّ المحاولات (10 محاولات/10 دقائق)
--      كي تعرض الشاشة «أوقفت المحاولات مؤقتاً» بدل «كلمة المرور غير صحيحة»
--      وهي صحيحة — وهو أكثر ما يحيّر المستخدم الجديد.
--   ⑧ توحيد اختيار الصف بين شاشة الدخول (registration_by_phone) ومفتاح التقدّم
--      (progress_session_open): «المعتمد أولاً ثم الأقدم». بعد إصلاح ④ تصبح كل
--      صفوف الرقم معتمدة، فيعود الاختيار إلى الأقدم نفسه ⇒ معرّف الطالب القائم
--      وتقدّمه لا يتغيّران.
--   ⑨ تصليب مقيس: app_password_hash كانت تُنفَّذ بـanon وتُعيد الهاش القديم لأي
--      رقم/كلمة ⇒ تُسحب صلاحيتها (كل الدوال تحتاجها تعمل بصلاحية مالكها).
--
-- ترتيب النشر: نفّذ هذا الملف ثم أعد نشر الويب (لا يلزم إعادة بناء APK؛
-- الشاشة الجديدة تكتفي بالمسار القديم إن لم تكن الدالة ⑦ موجودة).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ① تسجيل طالب: صفّ واحد لكل رقم (idempotent)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_student(
  p_name       TEXT,
  p_phone      TEXT,
  p_department TEXT DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  name        TEXT,
  phone       TEXT,
  department  TEXT,
  is_approved BOOLEAN,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  TEXT := left(btrim(COALESCE(p_name, '')), 120);
  v_phone TEXT := left(btrim(COALESCE(p_phone, '')), 20);
  v_dept  TEXT := NULLIF(left(btrim(COALESCE(p_department, '')), 40), '');
  v_id    uuid;
BEGIN
  IF v_name = '' OR length(v_phone) < 6 THEN
    RAISE EXCEPTION 'invalid registration data' USING ERRCODE = '22023';
  END IF;

  -- نقرتان سريعتان على «تسجيل» كانتا تُنتجان صفّين: القفل يمنع ذلك.
  PERFORM pg_advisory_xact_lock(hashtext('registration:' || v_phone));

  SELECT r.id INTO v_id
    FROM public.registrations r
   WHERE r.phone = v_phone
   ORDER BY r.is_approved DESC NULLS LAST, r.created_at ASC NULLS LAST
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- الرقم مسجّل: لا صفّ ثانٍ. نصحّح الاسم/التخصص فقط ما دام غير معتمد
    -- (خطأ إدخال)، ولا نلمس صفاً معتمداً حتى لا يُنتحل حساب قائم.
    UPDATE public.registrations r
       SET name       = v_name,
           department = COALESCE(v_dept, r.department)
     WHERE r.id = v_id
       AND r.is_approved IS NOT TRUE;

    RETURN QUERY
      SELECT r.id, r.name, r.phone, r.department, r.is_approved, r.created_at
        FROM public.registrations r
       WHERE r.id = v_id;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO public.registrations (name, phone, department, is_approved)
    VALUES (v_name, v_phone, v_dept, FALSE)
    RETURNING registrations.id,
              registrations.name,
              registrations.phone,
              registrations.department,
              registrations.is_approved,
              registrations.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.register_student(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_student(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- ② الاعتماد: كل صفوف الرقم، لا صفّاً واحداً
-- ----------------------------------------------------------------------------
-- شاشة الدخول تقرأ صفاً واحداً بالرقم (registration_by_phone → الأقدم).
-- فإذا بقيت صفوف أخرى للرقم بلا اعتماد، عاد الطالب إلى «بانتظار الموافقة»
-- رغم أن المطوّر ضغط «اعتماد». هنا يُعتمد الرقم كله بضغطة واحدة.
CREATE OR REPLACE FUNCTION public.approve_registration(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone   TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF NOT public.dev_token_ok() THEN
    RAISE EXCEPTION 'developer grant required' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid registration id' USING ERRCODE = '22023';
  END IF;

  SELECT r.phone INTO v_phone FROM public.registrations r WHERE r.id = p_id;

  -- الصف غير موجود → نجاح عديم الأثر (الزر يبقى آمناً للتكرار).
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'changed', 0);
  END IF;

  UPDATE public.registrations
     SET is_approved = TRUE
   WHERE phone = v_phone
     AND is_approved IS DISTINCT FROM TRUE;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_registration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_registration(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- ③ الحذف: كل صفوف الرقم + كلمة المرور + مفاتيح الجلسات
-- ----------------------------------------------------------------------------
-- حذف صفّ واحد كان يترك صفوفاً أخرى للرقم، فيبقى الرقم «مسجّلاً» ولا يستطيع
-- الطالب التسجيل من جديد بشكل نظيف.
CREATE OR REPLACE FUNCTION public.delete_registration(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone   TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF NOT public.dev_token_ok() THEN
    RAISE EXCEPTION 'developer grant required' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid registration id' USING ERRCODE = '22023';
  END IF;

  SELECT r.phone INTO v_phone FROM public.registrations r WHERE r.id = p_id;

  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'changed', 0);
  END IF;

  DELETE FROM public.user_passwords WHERE phone = v_phone;

  IF to_regclass('public.student_keys') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.student_keys
              WHERE user_id IN (SELECT id FROM public.registrations WHERE phone = $1)'
      USING v_phone;
  END IF;

  -- صفوف التقدّم (user_assignment_progress / user_study_progress) مرتبطة
  -- بـregistrations(id) ON DELETE CASCADE ⇒ تُحذف معها.
  DELETE FROM public.registrations WHERE phone = v_phone;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_registration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_registration(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- ④ إصلاح بيانات لمرة واحدة: أرقام لها صفّ معتمد → تُعتمد بقية صفوفها
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  UPDATE public.registrations r
     SET is_approved = TRUE
   WHERE r.is_approved IS NOT TRUE
     AND EXISTS (
       SELECT 1 FROM public.registrations a
        WHERE a.phone = r.phone AND a.is_approved
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE '④ صفوف مكرّرة أُعيد اعتمادها لمجاراة صفّ الرقم المعتمد: %', v_rows;
END $$;


-- ----------------------------------------------------------------------------
-- ⑤ فهرس فريد يمنع التكرار من أي نسخة قديمة من التطبيق
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_dupes INTEGER;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT r.phone FROM public.registrations r GROUP BY r.phone HAVING count(*) > 1
  ) d;

  IF v_dupes = 0 THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS registrations_phone_uidx
               ON public.registrations (phone)';
    RAISE NOTICE '⑤ فهرس فريد على registrations(phone) جاهز ✅';
  ELSE
    RAISE NOTICE '⑤ يوجد % رقماً مكرّراً — لم يُنشأ الفهرس الفريد. الدالة ① تمنع أي تكرار جديد.', v_dupes;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- ⑥ password_status — تُثبَّت في الهجرات (كانت في القاعدة فقط)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_status(p_phone TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'has_password', EXISTS (
      SELECT 1 FROM user_passwords up
      WHERE up.phone = p_phone AND up.password_hash IS NOT NULL
    ),
    'must_change', COALESCE((
      SELECT up2.must_change_password FROM user_passwords up2
      WHERE up2.phone = p_phone LIMIT 1
    ), FALSE)
  );
$$;

REVOKE ALL ON FUNCTION public.password_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_status(TEXT) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- ⑦ حالة حدّ محاولات الدخول — بدون كشف أي هاش
-- ----------------------------------------------------------------------------
-- verify_password يعيد false في حالتين: كلمة خطأ، أو تجاوز الحدّ (10 محاولات
-- في 10 دقائق). الشاشة كانت تقول «كلمة المرور غير صحيحة» في الحالتين، فيظن
-- المستخدم الجديد أن حسابه الجديد معطوب. هذه الدالة تفصل بينهما.
CREATE OR REPLACE FUNCTION public.password_login_blocked(p_phone TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'blocked', COALESCE(
                 COALESCE(t.attempts, 0) > 10
                 AND t.window_start > now() - INTERVAL '10 minutes',
                 FALSE),
    'attempts', COALESCE(t.attempts, 0),
    'retry_after_seconds', CASE
      WHEN COALESCE(t.attempts, 0) > 10
       AND t.window_start > now() - INTERVAL '10 minutes'
      THEN GREATEST(
             1,
             CEIL(EXTRACT(EPOCH FROM (t.window_start + INTERVAL '10 minutes' - now())))
           )::INT
      ELSE 0
    END
  )
  FROM (SELECT 1 AS one) base
  LEFT JOIN public.auth_throttle t
    ON t.scope = 'user_password'
   AND t.identifier = left(btrim(COALESCE(p_phone, '')), 200);
$$;

REVOKE ALL ON FUNCTION public.password_login_blocked(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_login_blocked(TEXT) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- ⑧ توحيد اختيار الصف: المعتمد أولاً ثم الأقدم
-- ----------------------------------------------------------------------------
-- كانت registration_by_phone (شاشة الدخول) و progress_session_open (مفتاح
-- التقدّم) تختاران **الأقدم** دائماً. فإذا كان الأقدم غير معتمد والآخر معتمد
-- بقي الطالب عالقاً على «بانتظار الموافقة». الآن القاعدتان متطابقتان:
--   is_approved DESC, created_at ASC  ⇒ بعد إصلاح ④ (كل الصفوف معتمدة) يعود
--   الاختيار إلى الأقدم نفسه، فلا يتغيّر معرّف أي طالب قائم ولا تقدّمه.
CREATE OR REPLACE FUNCTION public.registration_by_phone(p_phone TEXT)
RETURNS TABLE (
  id          uuid,
  name        TEXT,
  phone       TEXT,
  department  TEXT,
  is_approved BOOLEAN,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT := btrim(COALESCE(p_phone, ''));
BEGIN
  IF length(v_phone) < 6 THEN
    RETURN;  -- رقم غير صالح → لا صفوف
  END IF;

  RETURN QUERY
    SELECT r.id, r.name, r.phone, r.department, r.is_approved, r.created_at
      FROM public.registrations r
     WHERE r.phone = v_phone
     ORDER BY r.is_approved DESC NULLS LAST, r.created_at ASC NULLS LAST
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.registration_by_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_by_phone(TEXT) TO anon, authenticated;


-- نفس قاعدة الاختيار تماماً — وإلا صار مفتاح التقدّم مربوطاً بصف غير الذي
-- تحمله الجلسة، فتُفقد علامات الطالب بصمت.
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

  SELECT id INTO v_user FROM registrations WHERE phone = p_phone
   ORDER BY is_approved DESC NULLS LAST, created_at ASC NULLS LAST
   LIMIT 1;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'no_user');
  END IF;

  SELECT up.password_hash INTO v_hash FROM user_passwords up WHERE up.phone = p_phone;
  IF v_hash IS NULL OR NOT public.password_hash_check(p_phone, p_password, v_hash) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_password');
  END IF;

  IF v_hash NOT LIKE '$2%' THEN
    UPDATE user_passwords
       SET password_hash = public.password_hash_make(p_password),
           updated_at    = now()
     WHERE phone = p_phone;
  END IF;

  DELETE FROM auth_throttle WHERE scope = 'user_password' AND identifier = p_phone;
  INSERT INTO student_keys (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT progress_key INTO v_key FROM student_keys WHERE user_id = v_user;
  RETURN jsonb_build_object('ok', TRUE, 'user_id', v_user, 'key', v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.progress_session_open(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.progress_session_open(TEXT, TEXT) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- ⑨ تصليب: app_password_hash لم تكن محبوسة عن anon على القاعدة الحيّة
-- ----------------------------------------------------------------------------
-- القياس (scripts/check-security-migrations.mjs، بمفتاح anon فقط):
--   POST /rest/v1/rpc/app_password_hash {"p_phone":"a","p_password":"b"}
--   → 200 "78f0be89237d77f7a70e94e0ce7a43935e8931af91b392a1e1917a7c7a6c00a4"
-- أي أن أي شخص يملك المفتاح العام يستطيع حساب SHA-256(phone::password) لأي
-- رقم/كلمة — وهو أصل صيغة الهاش القديمة. سحبُها لا يكسر شيئاً: كل الدوال التي
-- تحتاجها (verify_password / progress_session_open / password_hash_check)
-- تعمل بصلاحية مالكها، والعميل يحسب الصيغة محلياً لا عبر RPC.
REVOKE ALL ON FUNCTION public.app_password_hash(TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- ⑩ تحقق ذاتي — يفشل التنفيذ بصوت عالٍ إن بقي شيء ناقص
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(fn, ', ') INTO v_missing
    FROM (VALUES
      ('public.register_student(text,text,text)'),
      ('public.approve_registration(uuid)'),
      ('public.delete_registration(uuid)'),
      ('public.password_status(text)'),
      ('public.password_login_blocked(text)'),
      ('public.registration_by_phone(text)'),
      ('public.progress_session_open(text,text)')
    ) AS f(fn)
   WHERE to_regprocedure(fn) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ناقصة بعد التنفيذ: %', v_missing;
  END IF;

  IF NOT has_function_privilege('anon', 'public.register_student(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ناقص: EXECUTE على register_student لـanon';
  END IF;
  IF NOT has_function_privilege('anon', 'public.password_login_blocked(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ناقص: EXECUTE على password_login_blocked لـanon';
  END IF;

  -- ⑨: يجب أن تبقى محبوسة (وإلا عاد حاسب الهاش القديم للعميل)
  IF has_function_privilege('anon', 'public.app_password_hash(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'غير محبوسة: app_password_hash ما زالت مناحة لـanon';
  END IF;

  RAISE NOTICE '⑩ دوال دخول المستخدم الجديد جاهزة ✅';
END $$;

COMMIT;

-- ============================================================================
-- التحقّق بعد التنفيذ (بمفتاح anon):
--   POST /rest/v1/rpc/register_student  {"p_name":"TEST ONE","p_phone":"700000909"}
--   POST /rest/v1/rpc/register_student  {"p_name":"TEST TWO","p_phone":"700000909"}
--        ← يجب أن يعيد **نفس المعرّف** في النداءين (لا صفّ ثانٍ).
--   POST /rest/v1/rpc/registration_by_phone {"p_phone":"700000909"}
--        ← صفّ واحد (الأقدم) — وهو نفس الصف الذي تعتمده اللوحة الآن.
--   POST /rest/v1/rpc/password_login_blocked {"p_phone":"700000909"}
--        ← {"blocked": false, "attempts": n, "retry_after_seconds": 0}
--
-- تنظيف صفوف الاختبار:
--   DELETE FROM public.user_passwords WHERE phone = '700000909';
--   DELETE FROM public.registrations  WHERE phone = '700000909';
-- ============================================================================
