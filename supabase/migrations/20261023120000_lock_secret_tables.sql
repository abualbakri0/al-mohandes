-- ============================================================================
-- إغلاق الجداول الحسّاسة أمام المفتاح العام — 23 أكتوبر 2026
-- ============================================================================
-- ما تم قياسه فعلياً على المشروع الحقيقي (بمفتاح anon المنشور في التطبيق):
--
--   GET    /rest/v1/push_tokens                    → 200  (token, department, is_developer)
--   POST   /rest/v1/push_tokens                    → 201  (زرع توكنات وهمية)
--   DELETE /rest/v1/push_tokens?token=eq.<token>   → 204  (تعطيل إشعارات أي جهاز)
--   GET    /rest/v1/user_passwords                 → 200  (سيُسرّب password_hash عند أول صف)
--   GET    /rest/v1/web_push_subscriptions         → 200  (endpoint + p256dh + auth)
--
-- ليش هذا الملف آمن ولا يكسر شيئاً:
--   • القراءة المباشرة (SELECT) غير مستخدمة إطلاقاً من التطبيق لهذه الجداول:
--       - push_tokens:            التسجيل عبر Edge Function، ثم RPC register_push_token،
--                                 ثم INSERT/UPDATE كاحتياط — كلها كتابة.
--       - user_passwords:          كل المنطق عبر RPC
--                                 (password_status / verify_password / set_password)
--                                 وهي SECURITY DEFINER ⇒ تعمل بلا صلاحيات للعميل.
--                                 والشيفرة أصلاً تتعامل مع غياب القراءة بأمان
--                                 (fetchPasswordStatus → mode:'none').
--       - web_push_subscriptions: التطبيق يكتب فقط (insert / update / delete).
--   • خدمة الإرسال (supabase/functions/push-notify) تستخدم service_role ⇒ لا تتأثر.
--   • الكتابة على push_tokens / web_push_subscriptions تبقى كما هي
--     ⇒ تسجيل الأجهزة وإلغاء التسجيل لا ينكسر.
--
-- آمن للتكرار (idempotent) — شغّله أكثر من مرة. التراجع في نهاية الملف.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) user_passwords — لا وصول مباشر إطلاقاً (لا قراءة ولا كتابة)
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_passwords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_user_passwords" ON public.user_passwords;
DROP POLICY IF EXISTS "anon_insert_user_passwords" ON public.user_passwords;
DROP POLICY IF EXISTS "anon_update_user_passwords" ON public.user_passwords;
DROP POLICY IF EXISTS "anon_delete_user_passwords" ON public.user_passwords;

REVOKE ALL ON TABLE public.user_passwords FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) push_tokens — الكتابة تبقى، القراءة تُغلق
-- ---------------------------------------------------------------------------
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- السياسة القديمة كانت FOR ALL (تشمل SELECT) ⇒ لا بد من إسقاطها كاملة
DROP POLICY IF EXISTS "push_tokens_anon_all"  ON public.push_tokens;
DROP POLICY IF EXISTS "anon_select_push_tokens" ON public.push_tokens;

-- إعادة إنشاء سياسات الكتابة فقط إن كانت غائبة (حتى لا يبقى الجدول مقفلاً)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'push_tokens' AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY "anon_insert_push_tokens" ON public.push_tokens
      FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'push_tokens' AND cmd = 'UPDATE'
  ) THEN
    CREATE POLICY "anon_update_push_tokens" ON public.push_tokens
      FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'push_tokens' AND cmd = 'DELETE'
  ) THEN
    CREATE POLICY "anon_delete_push_tokens" ON public.push_tokens
      FOR DELETE TO anon, authenticated USING (true);
  END IF;
END $$;

REVOKE SELECT ON TABLE public.push_tokens FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3) web_push_subscriptions — نفس المعالجة (بيانات اعتماد اشتراك المتصفح)
-- ---------------------------------------------------------------------------
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "web_push_anon_all"    ON public.web_push_subscriptions;
DROP POLICY IF EXISTS "anon_select_web_push" ON public.web_push_subscriptions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'web_push_subscriptions' AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY "anon_insert_web_push" ON public.web_push_subscriptions
      FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'web_push_subscriptions' AND cmd = 'UPDATE'
  ) THEN
    CREATE POLICY "anon_update_web_push" ON public.web_push_subscriptions
      FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'web_push_subscriptions' AND cmd = 'DELETE'
  ) THEN
    CREATE POLICY "anon_delete_web_push" ON public.web_push_subscriptions
      FOR DELETE TO anon, authenticated USING (true);
  END IF;
END $$;

REVOKE SELECT ON TABLE public.web_push_subscriptions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) تحقّق فوري (اقرأ الرسائل في تبويب Messages بعد التنفيذ)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pt_sel BOOLEAN := has_table_privilege('anon', 'public.push_tokens', 'SELECT');
  v_pt_ins BOOLEAN := has_table_privilege('anon', 'public.push_tokens', 'INSERT');
  v_up_sel BOOLEAN := has_table_privilege('anon', 'public.user_passwords', 'SELECT');
  v_wp_sel BOOLEAN := has_table_privilege('anon', 'public.web_push_subscriptions', 'SELECT');
  v_read_policies INTEGER;
BEGIN
  SELECT count(*) INTO v_read_policies
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('push_tokens', 'web_push_subscriptions', 'user_passwords')
     AND cmd IN ('SELECT', 'ALL');

  RAISE NOTICE 'push_tokens: SELECT=% (يجب false) · INSERT=% (يجب true)', v_pt_sel, v_pt_ins;
  RAISE NOTICE 'user_passwords: SELECT=% (يجب false)', v_up_sel;
  RAISE NOTICE 'web_push_subscriptions: SELECT=% (يجب false)', v_wp_sel;
  RAISE NOTICE 'سياسات قراءة متبقية على الجداول الثلاثة = % (يجب 0)', v_read_policies;
END $$;

COMMIT;

-- ============================================================================
-- التحقّق بعد التنفيذ (من الجهاز، بمفتاح anon):
--   GET /rest/v1/push_tokens?select=*&limit=1            → 401 / 42501  ✅
--   GET /rest/v1/user_passwords?select=*&limit=1         → 401 / 42501  ✅
--   GET /rest/v1/web_push_subscriptions?select=*&limit=1 → 401 / 42501  ✅
--   ثم من التطبيق: افتحه على جهاز → يجب أن يُسجَّل التوكن (تحقّق بـ push_diag()).
--   وأرسل إشعاراً تجريبياً من حساب المطوّر → يجب أن يصل.
-- ============================================================================
-- التراجع (إن انكسر تسجيل الأجهزة أو الإشعارات — نادر جداً):
--   GRANT SELECT ON TABLE public.push_tokens TO anon, authenticated;
--   CREATE POLICY "push_tokens_anon_all" ON public.push_tokens
--     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
--   GRANT ALL ON TABLE public.user_passwords TO anon, authenticated;
--   GRANT SELECT ON TABLE public.web_push_subscriptions TO anon, authenticated;
--   CREATE POLICY "web_push_anon_all" ON public.web_push_subscriptions
--     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
-- ============================================================================
