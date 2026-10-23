-- ⚠️ مُستبدَلة بالملف 20261023170000_registration_write_fix.sql — نفّذ ذلك الملف فقط.
--    (سبب الاستبدال: هذه الهجرة تمنح UPDATE/DELETE لكنها لا تمنح SELECT على
--     العمود id، وبدونه يفشل UPDATE/DELETE … WHERE id = $1 بـ42501 رغم المنح.)
--

-- إصلاح عاجل: المطوّر لا يستطيع اعتماد/حذف المسجّل، ولا إدارة الملاحظات/الإعدادات
-- ------------------------------------------------------------
-- المشكلة المقيسة (2026-10-23، بمفتاح anon، صفوف وهمية فقط):
--
--   table                 INSERT      UPDATE          DELETE
--   registrations         ✅          ❌ 42501        ❌ 42501
--   feedback_messages     ✅          ❌ 42501        ❌ 42501
--   app_settings          ❌ 42501    ❌ 42501        ❌ 42501
--   lectures/assignments/exams/reference_materials/study_tasks/notifications
--                         ✅          ✅              ✅
--
-- السبب:
--   الجداول الثلاثة أُنشئت بملفات هجرة (وليس من واجهة Supabase)، فلم تصلها
--   صلاحيات UPDATE/DELETE/INSERT التي تمنحها Supabase افتراضياً للجداول
--   الجديدة. سياسات RLS الخاصة بالمطوّر موجودة بالفعل
--   (dev_update_registrations / dev_delete_registrations / dev_update_feedback /
--    dev_delete_feedback / dev_update_app_settings) لكن RLS لا تُفحص أصلاً
--   إذا كانت صلاحية الجدول نفسها غير ممنوحة ⇒ PostgREST يرد 401 42501
--   قبل الوصول إلى السياسة. فيظهر للمطوّر أن زر «اعتماد» أو «حذف» لا يفعل شيئاً.
--
-- هذا الملف:
--   1) يمنح UPDATE/DELETE على registrations و feedback_messages.
--   2) يمنح UPDATE/INSERT على app_settings (شاشة الإعدادات تكتب صفاً واحداً).
--   3) يُنشئ سياسات المطوّر الناقصة فقط (لا يلمس الموجود).
--   4) يبقى SELECT مسحوباً — لا تُفتح قراءة بيانات الطلاب إطلاقاً.
--
-- لماذا هذا آمن؟
--   كل سياسة هنا مقيَّدة بـ dev_token_ok() — توقيع HMAC يتحقق منه Postgres
--   من الهيدر x-dev-token، ولا يمكن للطالب (أو أي مجهول) الحصول عليه.
--   بلا توكين صالح: UPDATE/DELETE تُطابق صفر صفوف، والبيانات لا تُقرأ.
--
-- قابل لإعادة التنفيذ بأمان (idempotent). التراجع: راجع آخر الملف.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) الصلاحيات الناقصة
-- ============================================================
GRANT UPDATE, DELETE ON public.registrations     TO anon, authenticated;
GRANT UPDATE, DELETE ON public.feedback_messages TO anon, authenticated;
GRANT UPDATE, INSERT ON public.app_settings      TO anon, authenticated;

-- ============================================================
-- 2) تأكيد أن القراءة ما زالت مغلقة (حماية من GRANT ALL مستقبلي)
-- ============================================================
REVOKE SELECT ON public.registrations     FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.feedback_messages FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3) سياسات المطوّر — تُنشأ فقط إن كانت مفقودة
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'registrations'
                    AND policyname = 'dev_update_registrations') THEN
    CREATE POLICY dev_update_registrations ON public.registrations
      FOR UPDATE TO anon, authenticated
      USING ((SELECT public.dev_token_ok()))
      WITH CHECK ((SELECT public.dev_token_ok()));
    RAISE NOTICE 'أُنشئت السياسة dev_update_registrations';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'registrations'
                    AND policyname = 'dev_delete_registrations') THEN
    CREATE POLICY dev_delete_registrations ON public.registrations
      FOR DELETE TO anon, authenticated
      USING ((SELECT public.dev_token_ok()));
    RAISE NOTICE 'أُنشئت السياسة dev_delete_registrations';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'feedback_messages'
                    AND policyname = 'dev_update_feedback') THEN
    CREATE POLICY dev_update_feedback ON public.feedback_messages
      FOR UPDATE TO anon, authenticated
      USING ((SELECT public.dev_token_ok()))
      WITH CHECK ((SELECT public.dev_token_ok()));
    RAISE NOTICE 'أُنشئت السياسة dev_update_feedback';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'feedback_messages'
                    AND policyname = 'dev_delete_feedback') THEN
    CREATE POLICY dev_delete_feedback ON public.feedback_messages
      FOR DELETE TO anon, authenticated
      USING ((SELECT public.dev_token_ok()));
    RAISE NOTICE 'أُنشئت السياسة dev_delete_feedback';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'app_settings'
                    AND policyname = 'dev_update_app_settings') THEN
    CREATE POLICY dev_update_app_settings ON public.app_settings
      FOR UPDATE TO anon, authenticated
      USING ((SELECT public.dev_token_ok()))
      WITH CHECK ((SELECT public.dev_token_ok()));
    RAISE NOTICE 'أُنشئت السياسة dev_update_app_settings';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'app_settings'
                    AND policyname = 'dev_insert_app_settings') THEN
    CREATE POLICY dev_insert_app_settings ON public.app_settings
      FOR INSERT TO anon, authenticated
      WITH CHECK ((SELECT public.dev_token_ok()));
    RAISE NOTICE 'أُنشئت السياسة dev_insert_app_settings';
  END IF;
END $$;

-- ============================================================
-- 4) تحقق ذاتي — يُفشل التنفيذ إن بقيت صلاحية ناقصة
-- ============================================================
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(x.t || ':' || x.p, ', ')
    INTO v_missing
    FROM (VALUES ('registrations', 'UPDATE'), ('registrations', 'DELETE'),
                 ('feedback_messages', 'UPDATE'), ('feedback_messages', 'DELETE'),
                 ('app_settings', 'UPDATE'), ('app_settings', 'INSERT')) AS x(t, p)
   WHERE NOT has_table_privilege('anon', 'public.' || x.t, x.p)
      OR NOT has_table_privilege('authenticated', 'public.' || x.t, x.p);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'صلاحيات ما زالت ناقصة: %', v_missing;
  END IF;

  IF has_table_privilege('anon', 'public.registrations', 'SELECT')
     OR has_table_privilege('anon', 'public.feedback_messages', 'SELECT') THEN
    RAISE EXCEPTION 'القراءة انفتحت بالخطأ — يجب أن يبقى SELECT مسحوباً';
  END IF;

  RAISE NOTICE 'صلاحيات المطوّر مكتملة ✅ · قراءة الطلاب ما زالت مغلقة ✅';
END $$;

-- ============================================================
-- 5) تنظيف صفوف التشخيص التي أنشأها الفحص الآلي
--    (مفتاح anon لا يملك DELETE، فتُحذف هنا مرة واحدة فقط)
-- ============================================================
DO $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM public.registrations
   WHERE phone = '700000000'
      OR name IN ('DIAG TEST', 'DIAG TEST 2', '__diag__');

  IF v_ids IS NULL THEN
    RAISE NOTICE 'لا صفوف تشخيص لتنظيفها';
    RETURN;
  END IF;

  IF to_regclass('public.student_keys') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.student_keys WHERE user_id = ANY ($1)' USING v_ids;
  END IF;

  DELETE FROM public.user_passwords WHERE phone = '700000000';

  IF to_regclass('public.auth_throttle') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.auth_throttle WHERE identifier = $1' USING '700000000';
  END IF;

  DELETE FROM public.registrations WHERE id = ANY (v_ids);

  RAISE NOTICE 'حُذف % صف تشخيص (رقم 700000000)', array_length(v_ids, 1);
END $$;

COMMIT;

-- ============================================================
-- التحقق بعد التنفيذ (بمفتاح anon من خارج التطبيق):
--   node scripts/diagnose-grants.mjs
--     المتوقع: registrations / feedback_messages / app_settings =
--              ok (0 rows) في UPDATE و DELETE.
--   ومن التطبيق كمطوّر (بتوكين صالح): اعتماد/حذف مسجّل → ينجح فوراً.
--   GET /rest/v1/registrations?select=* → يجب أن يبقى 401 42501.
--
-- التراجع (غير مطلوب عادةً):
--   REVOKE UPDATE, DELETE ON public.registrations     FROM anon, authenticated;
--   REVOKE UPDATE, DELETE ON public.feedback_messages FROM anon, authenticated;
--   REVOKE UPDATE, INSERT ON public.app_settings      FROM anon, authenticated;
-- ============================================================
