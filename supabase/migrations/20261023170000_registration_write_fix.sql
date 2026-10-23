-- ============================================================
-- 20261023170000_registration_write_fix.sql
-- العنوان: «المطوّر لا يستطيع اعتماد أو حذف المسجّل» — الإصلاح النهائي
-- ------------------------------------------------------------
-- الأثر المقيس (بمفتاح anon، صفّ وهمي فقط، 2026-10-23):
--
--   PATCH  /rest/v1/registrations?id=eq.…  →  401
--   {"code":"42501","message":"permission denied for table registrations",
--    "hint":"Grant the required privileges to the current role with:
--            GRANT SELECT ON public.registrations TO anon;"}
--
--   DELETE /rest/v1/registrations?id=eq.…  →  401 (نفس الجسم)
--   PATCH/DELETE على feedback_messages     →  401 (نفس السبب)
--
-- السبب الجذري (وهو ليس غياب UPDATE/DELETE كما بدا أول مرة):
--   في PostgreSQL، الأمر
--       UPDATE ... WHERE id = $1   /   DELETE ... WHERE id = $1
--   يحتاج **صلاحية SELECT على العمود المستخدم في شرط WHERE**، لا على الجدول
--   فقط. وهجرة الخصوصية 20261023011000 سحبت SELECT كاملاً من anon على
--   registrations و feedback_messages ⇒ كل PATCH/DELETE يفشل بـ42501
--   قبل أن يُفحص RLS وقبل أن تُقرأ أي بيانات. ولهذا كان الزر يبدو
--   كأنه «لا يفعل شيئاً» (الواجهة القديمة كانت تُخفي الخطأ).
--
-- هذا الملف يعالج المشكلة من طريقين، كلاهما آمن:
--
--   ①  صلاحية عمودية واحدة: GRANT SELECT (id) — تعيد للـWHERE قدرته دون
--      فتح أي قراءة: سياسات SELECT على الجدولين أُسقطت في هجرة الخصوصية،
--      فـ`GET /registrations?select=id` يبقى 0 صفوف (لا أسماء ولا هواتف).
--      هذا يُصلح أيضاً أي نسخة قديمة من التطبيق/APK على أجهزة المطوّر.
--
--   ②  دوال SECURITY DEFINER (approve_registration / delete_registration):
--      تعمل بصلاحية مالك الجدول، فلا تعتمد على أي GRANT، وتتحقق من توكين
--      المطوّر بنفسها وترد خطأً صريحاً «developer grant required» بدل
--      نجاح صامت بصفر صفوف. التطبيق يستخدمها أولاً.
--
--   حذف المسجّل يُنظّف معه user_passwords و student_keys، وإلا بقي الرقم
--   «طالباً عائداً» لا يستطيع التسجيل من جديد (current_required).
--
-- قابل لإعادة التنفيذ (idempotent) — لا يحذف بيانات ولا يُغيّر سياسات RLS.
-- ============================================================

BEGIN;

-- ============================================================
-- ① الصلاحيات: عمود WHERE + الكتابة
-- ============================================================
GRANT SELECT (id) ON public.registrations     TO anon, authenticated;
GRANT SELECT (id) ON public.feedback_messages TO anon, authenticated;

GRANT UPDATE, DELETE ON public.registrations     TO anon, authenticated;
GRANT UPDATE, DELETE ON public.feedback_messages TO anon, authenticated;
GRANT INSERT, UPDATE ON public.app_settings      TO anon, authenticated;

-- ============================================================
-- ② دوال المطوّر — لا تعتمد على صلاحيات الجداول
-- ============================================================
-- اعتماد مسجّل: تُرجع عدد الصفوف التي تغيّرت فعلاً (0 = معتمد أصلاً أو غير موجود).
CREATE OR REPLACE FUNCTION public.approve_registration(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER := 0;
BEGIN
  IF NOT public.dev_token_ok() THEN
    RAISE EXCEPTION 'developer grant required' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid registration id' USING ERRCODE = '22023';
  END IF;

  UPDATE public.registrations
     SET is_approved = TRUE
   WHERE id = p_id
     AND is_approved IS DISTINCT FROM TRUE;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_registration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_registration(uuid) TO anon, authenticated;


-- حذف مسجّل نهائياً + تنظيف كلمة مروره ومفاتيح جلسته.
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

  -- الصف غير موجود → نجاح عديم الأثر (زر الحذف يصبح آمناً للتكرار).
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'changed', 0);
  END IF;

  -- لولا هذا التنظيف لصار الرقم «طالباً عائداً» لحظة إعادة التسجيل، لأن
  -- set_password يرفض الكتابة عند وجود كلمة مرور (current_required).
  DELETE FROM public.user_passwords WHERE phone = v_phone;

  IF to_regclass('public.student_keys') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.student_keys WHERE user_id = $1' USING p_id;
  END IF;

  DELETE FROM public.registrations WHERE id = p_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_registration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_registration(uuid) TO anon, authenticated;

-- ============================================================
-- ③ تحقق ذاتي — يفشل التنفيذ بصوت عالٍ إن بقي شيء ناقص
-- ============================================================
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.registrations', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'ناقص: SELECT(id) على registrations';
  END IF;
  IF NOT has_table_privilege('anon', 'public.registrations', 'UPDATE') THEN
    RAISE EXCEPTION 'ناقص: UPDATE على registrations';
  END IF;
  IF NOT has_table_privilege('anon', 'public.registrations', 'DELETE') THEN
    RAISE EXCEPTION 'ناقص: DELETE على registrations';
  END IF;
  IF NOT has_column_privilege('anon', 'public.feedback_messages', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'ناقص: SELECT(id) على feedback_messages';
  END IF;
  IF NOT has_table_privilege('anon', 'public.feedback_messages', 'UPDATE') THEN
    RAISE EXCEPTION 'ناقص: UPDATE على feedback_messages';
  END IF;
  IF NOT has_table_privilege('anon', 'public.feedback_messages', 'DELETE') THEN
    RAISE EXCEPTION 'ناقص: DELETE على feedback_messages';
  END IF;
  IF NOT has_table_privilege('anon', 'public.app_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'ناقص: UPDATE على app_settings';
  END IF;
  IF NOT has_table_privilege('anon', 'public.app_settings', 'INSERT') THEN
    RAISE EXCEPTION 'ناقص: INSERT على app_settings';
  END IF;
  IF to_regprocedure('public.approve_registration(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ناقصة: الدالة approve_registration';
  END IF;
  IF to_regprocedure('public.delete_registration(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ناقصة: الدالة delete_registration';
  END IF;

  RAISE NOTICE 'صلاحيات المطوّر + الدوال جاهزة ✅';
END $$;

-- ============================================================
-- ④ تأكيد أن القراءة ما زالت مغلقة (لا سياسة SELECT على الجدولين)
-- ============================================================
DO $$
DECLARE
  v_leak TEXT;
BEGIN
  SELECT string_agg(DISTINCT tablename, ', ') INTO v_leak
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('registrations', 'feedback_messages')
     AND cmd IN ('SELECT', 'ALL');

  IF v_leak IS NOT NULL THEN
    RAISE NOTICE 'تنبيه: توجد سياسة قراءة على % — راجع هجرة الخصوصية 20261023011000', v_leak;
  ELSE
    RAISE NOTICE 'القراءة ما زالت مغلقة ✅ (SELECT(id) وحده ممنوح، وRLS يخفي الصفوف)';
  END IF;
END $$;

COMMIT;
