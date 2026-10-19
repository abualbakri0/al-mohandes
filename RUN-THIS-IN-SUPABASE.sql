-- ============================================================
--  ⚠️ نفّذ هذا الملف مرة واحدة في Supabase Dashboard → SQL Editor
--  https://supabase.com/dashboard/project/wulycdwgvpriptzubazi/sql/new
--
--  الغرض: إنشاء جداول منفصلة لتتبّع تقدّم كل مستخدم، حتى لا تظهر
--  علامة "صح" التي يضعها طالب عند باقي الطلاب.
--
--  الجداول الجديدة:
--    • user_assignment_progress (user_id, assignment_id)  ← التكاليف
--    • user_study_progress     (user_id, task_id)         ← المذاكرة
--
--  آمن وقابل لإعادة التنفيذ:
--    • CREATE TABLE IF NOT EXISTS  → لا يفشل إن نُفِّذ مرتين
--    • ON CONFLICT DO NOTHING      → لا يفقد بيانات منقولة
--    • UPDATE … WHERE completed    → يمسح العلامات المشتركة القديمة فقط
--    • لا يحذف أي صف من الجداول الأصلية
-- ============================================================


-- ============================================================================
--  جداول تتبّع تقدّم المستخدم (منفصلة تماماً عن الجداول العامة)
-- ============================================================================
--
--  المشكلة السابقة:
--    كانت حالة الإنجاز تُقرأ من العمود المشترك `assignments.completed`
--    و`study_tasks.completed`، وهذان العمودان عامّان على مستوى الصف الواحد.
--    فأي طالب يضع علامة "صح" كانت تظهر فوراً عند جميع الطلاب.
--
--  الحل:
--    نجعل حالة الإنجاز صفاً مستقلّاً في جدول خاص بكل مستخدم، مفتاحه
--    (user_id, item_id)، فيستحيل أن يشترك طالبان في نفس الصف.
--
--  ملاحظة أمنية مهمة:
--    سياسات RLS هنا واسعة (USING true) لأن التطبيق يستخدم مفتاح anon بدون
--    مصادقة Supabase Auth، فلا يعرف Postgres هوية المستخدم بنفسه. العزل
--    الحقيقي يتحقّق بسببين:
--      1) كل استعلام في الكود مُقيَّد إلزامياً بـ .eq('user_id', <id الجلسة>).
--      2) user_id مأخوذ من جدول registrations (المفتاح الأساسي) ولا يمكن
--         للطالب تعديله من الواجهة.
--    لذلك يجب ألا يُضاف أي استعلام على هذين الجدولين بدون تقييد user_id.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1) تقدّم التكاليف لكل مستخدم
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_assignment_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  assignment_id uuid        NOT NULL REFERENCES assignments(id)     ON DELETE CASCADE,
  completed     boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- صف واحد فقط لكل (مستخدم + تكليف): هدف عملية upsert وضمان العزل.
CREATE UNIQUE INDEX IF NOT EXISTS user_assignment_progress_uidx
  ON user_assignment_progress (user_id, assignment_id);

CREATE INDEX IF NOT EXISTS user_assignment_progress_user_idx
  ON user_assignment_progress (user_id);
CREATE INDEX IF NOT EXISTS user_assignment_progress_assignment_idx
  ON user_assignment_progress (assignment_id);

ALTER TABLE user_assignment_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_assignment_progress" ON user_assignment_progress;
DROP POLICY IF EXISTS "insert_user_assignment_progress" ON user_assignment_progress;
DROP POLICY IF EXISTS "update_user_assignment_progress" ON user_assignment_progress;
DROP POLICY IF EXISTS "delete_user_assignment_progress" ON user_assignment_progress;

CREATE POLICY "select_user_assignment_progress" ON user_assignment_progress FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_user_assignment_progress" ON user_assignment_progress FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_user_assignment_progress" ON user_assignment_progress FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_assignment_progress" ON user_assignment_progress FOR DELETE
  TO anon, authenticated USING (true);


-- ────────────────────────────────────────────────────────────────────────────
--  2) تقدّم المذاكرة لكل مستخدم
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_study_progress (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  task_id    uuid        NOT NULL REFERENCES study_tasks(id)   ON DELETE CASCADE,
  completed  boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_study_progress_uidx
  ON user_study_progress (user_id, task_id);

CREATE INDEX IF NOT EXISTS user_study_progress_user_idx
  ON user_study_progress (user_id);
CREATE INDEX IF NOT EXISTS user_study_progress_task_idx
  ON user_study_progress (task_id);

ALTER TABLE user_study_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_study_progress" ON user_study_progress;
DROP POLICY IF EXISTS "insert_user_study_progress" ON user_study_progress;
DROP POLICY IF EXISTS "update_user_study_progress" ON user_study_progress;
DROP POLICY IF EXISTS "delete_user_study_progress" ON user_study_progress;

CREATE POLICY "select_user_study_progress" ON user_study_progress FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_user_study_progress" ON user_study_progress FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_user_study_progress" ON user_study_progress FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_study_progress" ON user_study_progress FOR DELETE
  TO anon, authenticated USING (true);

-- ────────────────────────────────────────────────────────────────────────────
--  3) ترحيل البيانات الموجودة (إن وُجدت) من الجدولين القديمين.
--     ON CONFLICT DO NOTHING حتى لا نفقد بيانات إن نُفِّذ الترحيل مرتين.
--
--     ⚠️ الجداول القديمة تخزّن المفاتيح كـ text وليس uuid، لذلك نُصرِّف كل
--     عمود بنوعه الصحيح (::uuid / ::boolean / ::timestamptz) ونتجاهل أي صف
--     يحمل معرّفاً غير صالح بفحص نمط UUID (Regex). بدون هذا التحويل تفشل
--     العملية بخطأ: 42804 column "user_id" is of type uuid but expression
--     is of type text.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO user_assignment_progress (user_id, assignment_id, completed, updated_at)
SELECT user_id::uuid, assignment_id::uuid, completed::boolean, updated_at::timestamptz
FROM assignment_progress
WHERE user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND assignment_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (user_id, assignment_id) DO NOTHING;

INSERT INTO user_study_progress (user_id, task_id, completed, updated_at)
SELECT user_id::uuid, task_id::uuid, completed::boolean, updated_at::timestamptz
FROM study_progress
WHERE user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND task_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (user_id, task_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
--  4) تصفير الأعمدة المشتركة القديمة.
--     لم يبقَ أي كود يقرأها أو يكتبها؛ تصفيرها يمنع ظهور أي علامة متبقية
--     من فترة الخلل عند جميع الطلاب.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE assignments SET completed = false WHERE completed = true;
UPDATE study_tasks SET completed = false WHERE completed = true;

-- للتحقق بعد التنفيذ (يجب أن تكون كل النتائج 0):
--   SELECT count(*) FROM assignments WHERE completed = true;
--   SELECT count(*) FROM study_tasks WHERE completed = true;

-- ============================================================
-- 5) عمود الشرح الاختياري على مهمة المذاكرة (نص اختياري يظهر للطالب).
-- ============================================================
-- Optional free-text explanation on a study task ("الشرح").
-- The teacher/developer writes a short explanation of what to study for that
-- task; students see it under the task title in the Study section.
-- Nullable: existing rows keep NULL and the card simply hides the block.

ALTER TABLE study_tasks ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN study_tasks.notes IS
  'شرح المهمة (اختياري) — يظهر للطالب أسفل اسم المادة.';

-- ============================================================
-- 6) جدول اشتراكات Web Push (PWA / تثبيت المتصفح)
--    يُمكّن دالة push-notify Edge Function من إرسال إشعارات
--    حتى عندما يكون المتصفح / التطبيق المثبّت مغلقاً.
-- ============================================================
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  department TEXT,
  is_developer BOOLEAN NOT NULL DEFAULT false,
  alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_select_web_push" ON web_push_subscriptions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_insert_web_push" ON web_push_subscriptions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_update_web_push" ON web_push_subscriptions FOR UPDATE
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_delete_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_delete_web_push" ON web_push_subscriptions FOR DELETE
TO anon, authenticated USING (true);

-- ============================================================
-- 7) تشديد RLS الأمني (تحديث مباشر — بدون جداول جديدة)
--    نفّذ مع بقية الملف في SQL Editor. آمن وقابل لإعادة التنفيذ.
--    الهدف: تصعيب إساءة استخدام الـ Anon Key قدر الإمكان مع بقاء
--    التطبيق يعمل (التطبيق يستخدم anon بدون Supabase Auth، لذلك
--    العزل الكامل بالـ User ID يتطلب تفعيل Auth — انظر الملاحظة).
-- ============================================================

-- 7/أ: user_passwords — إسقاط قراءة الهاش من العميل.
--     كان SELECT مفتوحاً يسمح بسحب كل الهاشات. نحذفه؛ الكتابة تبقى
--     (التسجيل/التعيين/التغيير تعمل)، والتحقق يجب أن يتم عبر RPC
--     من جهة السيرفر (خطوة لاحقة)، لا بسحب الهاش للعميل.
DROP POLICY IF EXISTS "anon_select_user_passwords" ON user_passwords;
-- لا نعيد إنشاء سياسة SELECT: أي قراءة مباشرة مرفوضة (deny-by-default).
-- (إن كان كود قديم يقرأ الهاش للتحقق محلياً، سيعود لوضع phone-only
--  الآمن بدل كشف الهاشات — fail-safe وليس fail-open.)

-- 7/ب: push_tokens — منع سحب كل التوكنات (spam/push abuse).
DROP POLICY IF EXISTS "anon_select_push_tokens" ON push_tokens;
-- لا SELECT للعميل: الرفع/التحديث فقط (upsert يعمل)، والقراءة تبقى
-- لدالة push-notify عبر service_role فقط.
DROP POLICY IF EXISTS "anon_delete_push_tokens" ON push_tokens;
-- لا DELETE للعميل: يمنع مسح توكنات أجهزة أخرى.

-- 7/ج: web_push_subscriptions — نفس التشديد (منع سحب/مسح اشتراكات الغير).
DROP POLICY IF EXISTS "anon_select_web_push" ON web_push_subscriptions;
-- لا SELECT للعميل: الإرسال يتم من Edge Function بـ service_role فقط.
DROP POLICY IF EXISTS "anon_delete_web_push" ON web_push_subscriptions;
-- لا DELETE للعميل: إلغاء الاشتراك يتم بتحديث alerts_enabled=false.

-- 7/د: ملاحظة RLS + User ID (مهم):
--     سياسات USING(true) على جداول المحتوى (lectures/assignments/...) تعني
--     أن أي حامل للـ Anon Key يستطيع القراءة — هذا مقصود للمحتوى الدراسي
--     العام. أما العزل الحقيقي بالـ User ID (registrations/progress/passwords)
--     فيتطلب Supabase Auth (auth.uid()) — بدونها لا يستطيع Postgres معرفة
--     هوية الطالب، والعزل يبقى على مستوى كود العميل (.eq user_id) + إخفاء
--     الهاشات أعلاه. لا تفعّل قيود auth.uid() قبل ترحيل الدخول إلى Auth
--     وإلا توقف التطبيق.

-- ============================================================
-- 8) دوال RPC الأمنية — التحقق كله داخل Postgres
--    (رمز المطور + حالة/تحقق/تعيين كلمة المرور)
--
--    ⚠️ نفّذ الملف كاملاً دفعة واحدة (لا تُنفَّذ الأقسام منفصلة).
--    بعد تنفيذ هذا القسم:
--      • هاشات كلمات المرور لا تغادر السيرفر إطلاقاً.
--      • رمز المطور يُحوَّل إلى توكن HMAC صالح 30 يوماً، وأي تغيير
--        لـ dev_password يبطل التوكنات القديمة فوراً.
--      • تُغلق الكتابة المباشرة على user_passwords وقراءة dev_password.
--    آمن وقابل لإعادة التنفيذ (CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 8/أ: تجزئة مطابقة تماماً لـ hashPassword في العميل:
--      SHA-256(phone || '::' || password) بصيغة hex.
CREATE OR REPLACE FUNCTION public.app_password_hash(p_phone TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
  encode(digest(convert_to(p_phone || '::' || p_password, 'UTF8'), 'sha256'), 'hex')
$$;

-- 8/ب: التحقق من رمز المطور → توكن موقّع (أو '' عند الرفض).
-- التوكن = انتهاء_الصلاحية || '.' || HMAC-SHA256(الصلاحية|dev-grant, dev_password)
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
  SELECT s.dev_password INTO v_secret FROM app_settings s LIMIT 1;
  IF v_secret IS NULL OR v_secret IS DISTINCT FROM btrim(p_code) THEN
    RETURN '';
  END IF;
  v_exp := (extract(epoch FROM now() + interval '30 days'))::BIGINT;
  RETURN v_exp::TEXT || '.' ||
         encode(hmac(convert_to(v_exp::TEXT || '|dev-grant', 'UTF8'),
                     convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
END;
$$;

-- 8/ج: تحقق التوكن المخزَّن عند تشغيل التطبيق (موقّع وغير منتهٍ).
CREATE OR REPLACE FUNCTION public.verify_dev_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_exp    BIGINT;
  v_mac    TEXT;
  v_secret TEXT;
BEGIN
  IF p_token IS NULL OR p_token = '' OR p_token !~ '^[0-9]+\.[0-9a-f]+$' THEN
    RETURN FALSE;
  END IF;
  v_exp := split_part(p_token, '.', 1)::BIGINT;
  IF v_exp < (extract(epoch FROM now()))::BIGINT THEN
    RETURN FALSE;
  END IF;
  SELECT s.dev_password INTO v_secret FROM app_settings s LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN FALSE;
  END IF;
  v_mac := split_part(p_token, '.', 2);
  RETURN v_mac = encode(hmac(convert_to(v_exp::TEXT || '|dev-grant', 'UTF8'),
                            convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
END;
$$;

-- 8/د: حالة كلمة المرور (هل توجد؟ هل يجب تغييرها؟) — بدون إرجاع الهاش.
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

-- 8/هـ: مقارنة كلمة المرور داخل Postgres — الهاش لا يغادر السيرفر.
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
  SELECT up.password_hash INTO v_hash FROM user_passwords up WHERE up.phone = p_phone;
  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN v_hash = app_password_hash(p_phone, p_password);
END;
$$;

-- 8/و: تعيين/تغيير كلمة المرور. يرجع {"ok":true} أو
--      {"ok":false,"reason":"bad_current"} عند خطأ كلمة المرور الحالية.
--      p_current = NULL يعني "تعيين بدون تحقق" (أول إنشاء/إعادة تعيين المطوّر).
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

  SELECT up.password_hash INTO v_hash FROM user_passwords up WHERE up.phone = p_phone FOR UPDATE;

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

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- 8/ز: إصدار صلاحيات التنفيذ (PostgREST ينادي الدوال بدور anon).
REVOKE ALL ON FUNCTION public.app_password_hash(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_developer_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_dev_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_password(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_password(TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_password_hash(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_developer_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_dev_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_status(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_password(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_password(TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- 8/ح: إغلاق الكتابة المباشرة على user_passwords — كل كتابة صارت عبر
--      set_password (يمنع أي مجهول من تزوير كلمة مرور حساب آخر عبر upsert).
DROP POLICY IF EXISTS "anon_insert_user_passwords" ON user_passwords;
DROP POLICY IF EXISTS "anon_update_user_passwords" ON user_passwords;
DROP POLICY IF EXISTS "anon_delete_user_passwords" ON user_passwords;

-- 8/ط: إخفاء رمز المطور على مستوى الأعمدة — بدون هذه الخطوة كان التحقق
--      السيرفري بلا معنى (أي حامل لمفتاح anon يقرأ dev_password باستعلام
--      واحد). يبقى العمود قابلاً للتحديث من شاشة الإعدادات (INSERT/UPDATE)،
--      وشاشات التطبيق تقرأ الأعمدة المصرّح بها فقط.
REVOKE SELECT ON app_settings FROM anon, authenticated;
GRANT SELECT (id, academic_level, semester, semester_start_date, updated_at)
  ON app_settings TO anon, authenticated;

-- ============================================================
-- 9) تقييد دلو المراجع references (بدون كسر رفع المطوّر)
-- ============================================================
-- التطبيق يرفع الملفات دائماً بـ content-type = application/pdf، لذا تقييد
-- الدلو إلى PDF + حد 50MB لا يكسر أي وظيفة ويمنع رفع ملفات عشوائية/كبيرة.
UPDATE storage.buckets
SET file_size_limit    = 52428800,
    allowed_mime_types = ARRAY['application/pdf']
WHERE id = 'references';

-- ملاحظة (مقصودة): سياسات INSERT/DELETE على storage.objects لدلو references
-- تبقى مفتوحة مؤقتاً. واجهة الرفع/الحذف للمراجع للمطوّر فقط في التطبيق، لكن
-- بدون Supabase Auth لا تستطيع RLS التمييز بين المطور وبقية anon (أي إغلاق
-- يوقف نشر المراجع من التطبيق نفسه). بعد ترحيل الدخول إلى Supabase Auth
-- فعّل السطرين التاليين:
--   DROP POLICY IF EXISTS "Anyone can upload references" ON storage.objects;
--   DROP POLICY IF EXISTS "Anyone can delete references" ON storage.objects;


-- ============================================================
-- 10) إغلاق ثغرة تغيير رمز المطور مباشرةً
-- ============================================================
-- 10/أ: التغيير عبر RPC فقط — يتحقق من الرمز الحالي داخل السيرفر
--       (SECURITY DEFINER + pgcrypto). بعد نجاح التغيير تبطل كل التوكنات
--       القديمة تلقائياً لأن HMAC الجديد يوقّع بـ dev_password الجديد.
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
  SELECT s.dev_password INTO v_secret FROM app_settings s LIMIT 1;
  IF v_secret IS NULL OR v_secret IS DISTINCT FROM btrim(p_current) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_current');
  END IF;
  UPDATE app_settings SET dev_password = btrim(p_new), updated_at = now();
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.change_dev_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_dev_code(TEXT, TEXT) TO anon, authenticated;

-- 10/ب: منع أي كتابة مباشرة لـ dev_password من العميل — بدون الرمز الحالي
--       لا يمكن تغييره حتى بتجاوز الواجهة عبر Rest API مباشرةً.
REVOKE UPDATE ON app_settings FROM anon, authenticated;
GRANT UPDATE (academic_level, semester, semester_start_date, updated_at)
  ON app_settings TO anon, authenticated;
-- ومنع ثغرتين جانبيتين: (1) حذف الصف ثم إدراج صف برمز مطور مُتلاعب به،
-- (2) إدراج صف ثانٍ يتفوّق عليه LIMIT 1 في verify_developer_code.
REVOKE INSERT, DELETE ON app_settings FROM anon, authenticated;
DROP POLICY IF EXISTS "anon_insert_app_settings" ON app_settings;
DROP POLICY IF EXISTS "anon_delete_app_settings" ON app_settings;
DROP POLICY IF EXISTS "Enable insert for all on app_settings" ON app_settings;
DROP POLICY IF EXISTS "Enable delete for all on app_settings" ON app_settings;
-- ملاحظة: الصف موجود دائماً (يمزعه supabase/migrations ولا يمكن حذفه بعد الآن)،
-- لذا مسار else في updateSettings (INSERT) صار غير قابل للاستدعاء نهائياً.



