-- ============================================================
-- 20261023011000_lock_pii_reads.sql
-- المرحلة 2: إغلاق قراءة بيانات الطلاب والملاحظات نهائياً
-- ------------------------------------------------------------
-- ⚠️ ترتيب التنفيذ إلزامي:
--   1) نفّذ 20261023010000_registration_read_rpcs.sql   (آمن، لا يكسر شيئاً)
--   2) انشر النسخة الجديدة من التطبيق (ويب + APK) التي تستخدم الدوال الجديدة
--   3) ثم نفّذ هذا الملف
--
-- لماذا؟ هذا الملف يسحب صلاحية SELECT على الجدولين من المفتاح العام.
-- النسخ القديمة من التطبيق كانت تقرأ الجدول مباشرة (وكانت تكتب INSERT
-- ثم تطلب RETURNING، وهذا يحتاج SELECT أيضاً)، لذلك بعد التنفيذ:
--   • أي نسخة قديمة (APK قديم) → تسجيل الدخول/التسجيل الجديد فيها يفشل
--     ويطلب التحديث. المحتوى (محاضرات/امتحانات/إشعارات) لا يتأثر إطلاقاً،
--     والمستخدم المسجّل دخوله مسبقاً يبقى يعمل طبيعياً.
--   • النسخة الجديدة → تستخدم registration_by_phone / register_student /
--     list_registrations / submit_feedback / list_feedback → تعمل طبيعياً.
--
-- ما يفعله الملف:
--   1) يسقط أي سياسة SELECT على registrations و feedback_messages.
--   2) يسحب صلاحية SELECT من PUBLIC و anon و authenticated.
--      (service_role ومالك الجداول يبقيان قادرين — لوحة Supabase تعمل كما هي.)
--
-- ملاحظة عن التحديث الفوري: قناة realtime الخاصة بجدول registrations تتبع
-- RLS، لذا لن تصل أحداث INSERT الحيّة إلى شاشة المطوّر بعد الآن (الشاشة
-- تُحدِّث القائمة عند فتحها). نظام الإشعارات (notifications + realtime +
-- push) لم يُلمس إطلاقاً في هذا الملف.
--
-- قابل لإعادة التنفيذ بأمان (idempotent).
-- ============================================================


-- ============================================================
-- 1) إسقاط سياسات القراءة العامة (بأي اسم كانت)
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
         AND cmd IN ('SELECT', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;
END $$;


-- ============================================================
-- 2) سحب صلاحية القراءة من أدوار العميل
-- ============================================================
-- الإدخال/التعديل/الحذف تبقى كما هي (محمية بـ RLS + توكين المطوّر).
-- القراءة الوحيدة الممكنة الآن عبر الدوال المُعرَّفة في الملف السابق.
REVOKE SELECT ON public.registrations     FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.feedback_messages FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 3) تحقق سريع (نفّذه يدوياً بعد التنفيذ)
-- ============================================================
-- من خارج التطبيق (بمفتاح anon) يجب أن يعطي 401 permission denied:
--   GET /rest/v1/registrations?select=*
--   GET /rest/v1/feedback_messages?select=*
--
-- ومن داخل SQL Editor:
--   SELECT has_table_privilege('anon', 'public.registrations', 'SELECT');      -- false
--   SELECT has_table_privilege('anon', 'public.feedback_messages', 'SELECT');  -- false
--   SELECT public.registration_by_phone('779809243');                          -- صف واحد
