-- ============================================================================
-- تحقّق للقراءة فقط — لا يغيّر أي شيء ولا يكتب أي صف.
-- انسخ كل الملف في SQL Editor واضغط Run، ثم أرسل الجداول الثلاثة الناتجة.
-- (نُفّذ في محرّر Supabase بدور postgres، لذا يرى ما لا يراه مفتاح anon.)
-- ============================================================================

-- (1) الدوال: موجودة؟ بتوقيعها الصحيح؟ SECURITY DEFINER؟ مَن يستطيع تنفيذها؟
SELECT p.proname                              AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef                            AS security_definer,
       pg_get_userbyid(p.proowner)            AS owner,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('app_password_hash', 'password_hash_make', 'password_hash_check',
                     'verify_password', 'set_password', 'password_status',
                     'progress_session_open', 'unregister_push_token', 'unregister_web_push')
 ORDER BY p.proname, 2;

-- (2) bcrypt متاح؟ والهاشات الحالية بأي صيغة؟
WITH h AS (SELECT crypt('test', gen_salt('bf', 10)) AS v)
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto')      AS pgcrypto_installed,
       (SELECT v LIKE '$2%' FROM h)                                       AS bcrypt_generates,
       (SELECT crypt('test', v) = v FROM h)                               AS bcrypt_verifies,
       (SELECT crypt('wrong', v) <> v FROM h)                             AS bcrypt_rejects_wrong,
       (SELECT count(*) FROM public.user_passwords)                       AS password_rows,
       (SELECT count(*) FROM public.user_passwords WHERE password_hash LIKE '$2%')          AS bcrypt_rows,
       (SELECT count(*) FROM public.user_passwords
         WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%')                   AS legacy_sha256_rows;

-- (3) اختبار وحدات لدالة التحقق بصيغتيها (لا يقرأ ولا يكتب أي صف)
SELECT public.password_hash_check('0500000000', 'pw', public.app_password_hash('0500000000', 'pw')) AS legacy_format_accepted,
       public.password_hash_check('0500000000', 'wrong', public.app_password_hash('0500000000', 'pw')) AS legacy_format_rejects_wrong;

-- (4) صلاحيات القراءة على الجداول السرّية (يجب أن تكون false لـ anon)
SELECT c.relname                                AS table_name,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('push_tokens', 'user_passwords', 'web_push_subscriptions', 'notifications')
 ORDER BY c.relname;
