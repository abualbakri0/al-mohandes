-- ============================================================================
-- ترقية تجزئة كلمات المرور إلى bcrypt — 23 أكتوبر 2026
-- ============================================================================
-- الوضع الحالي (مقيس): الهاش المخزَّن هو
--     SHA-256( phone + '::' + password )   → 64 حرفاً hex
-- وهي تجزئة سريعة (بلا ملح خاص ولا كلفة) ⇒ من حصل على صف الجدول يستطيع
-- تجربة آلاف الكلمات في الثانية على GPU. bcrypt يوقف ذلك عملياً.
--
-- التصميم — بلا كسر أي تسجيل دخول:
--   • الهاش الجديد = crypt(password, gen_salt('bf', 10)) ويبدأ بـ '$2a$10$'.
--   • التحقق واحد للصيغتين: password_hash_check() تكتشف الصيغة من الهاش نفسه.
--   • الهاش القديم يبقى صالحاً، ويُرقّى **تلقائياً** إلى bcrypt في أول دخول
--     ناجح (verify_password / progress_session_open) — لا حاجة لإعادة تعيين.
--   • لا يخرج أي هاش إلى العميل: الدوال SECURITY DEFINER والبريد عبر RPC.
--   • حدود المحاولات (auth_throttle) تبقى كما هي حرفياً.
--
-- المتطلب: شغّل 20261023140000_reconcile_schema.sql أولاً (يضمن
--           app_password_hash و user_passwords و pgcrypto).
-- آمن للتكرار (idempotent). لا تراجع بعد الترقية — التفاصيل في النهاية.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) شروط مسبقة
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_password_hash'
  ) THEN
    RAISE EXCEPTION 'app_password_hash غير موجودة — شغّل 20261023140000_reconcile_schema.sql أولاً.';
  END IF;

  IF to_regclass('public.user_passwords') IS NULL THEN
    RAISE EXCEPTION 'جدول public.user_passwords غير موجود — شغّل ملف المصالحة أولاً.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'امتداد pgcrypto غير مثبّت — شغّل ملف المصالحة أولاً.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) دالتا التجزئة والتحقق (لا تُمنح لأي دور عميل)
--    ملاحظة: bcrypt يتجاهل ما بعد 72 بايتاً — مقبول هنا (كلمات مرور قصيرة).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_hash_make(p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF p_password IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN crypt(p_password, gen_salt('bf', 10));
END;
$$;

REVOKE ALL ON FUNCTION public.password_hash_make(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_hash_make(TEXT) FROM anon, authenticated;

-- يتحقق من كلمة المرور مقابل أي صيغة هاش (bcrypt الجديدة أو SHA-256 القديمة).
CREATE OR REPLACE FUNCTION public.password_hash_check(
  p_phone    TEXT,
  p_password TEXT,
  p_stored   TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF p_stored IS NULL OR p_password IS NULL THEN
    RETURN FALSE;
  END IF;

  -- bcrypt يبدأ دائماً بـ $2a$ / $2b$ / $2y$
  IF p_stored LIKE '$2%' THEN
    RETURN crypt(p_password, p_stored) = p_stored;
  END IF;

  -- صيغة ما قبل الترقية (SHA-256 مملّح بالهاتف)
  RETURN p_stored = public.app_password_hash(p_phone, p_password);
END;
$$;

REVOKE ALL ON FUNCTION public.password_hash_check(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_hash_check(TEXT, TEXT, TEXT) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) verify_password — نفس منطق الحدّ، مع ترقية الهاش عند النجاح
-- ---------------------------------------------------------------------------
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

  IF NOT public.password_hash_check(p_phone, p_password, v_hash) THEN
    RETURN FALSE;
  END IF;

  -- ترقية تلقائية: أول دخول ناجح يحوّل الهاش القديم إلى bcrypt.
  IF v_hash NOT LIKE '$2%' THEN
    UPDATE user_passwords
       SET password_hash = public.password_hash_make(p_password),
           updated_at    = now()
     WHERE phone = p_phone;
  END IF;

  DELETE FROM auth_throttle WHERE scope = 'user_password' AND identifier = p_phone;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_password(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_password(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) set_password — كل كتابة جديدة تُخزَّن bcrypt
-- ---------------------------------------------------------------------------
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

  -- نفس حماية اختطاف الحساب: لا استبدال بلا كلمة حالية إلا لتسجيل جديد
  -- أو بتوكين مطوّر صالح أو في حالة «يجب تغيير كلمة المرور».
  IF v_hash IS NOT NULL AND p_current IS NULL AND NOT public.dev_token_ok() THEN
    IF NOT COALESCE((
      SELECT up2.must_change_password FROM user_passwords up2
       WHERE up2.phone = p_phone LIMIT 1
    ), FALSE) THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'current_required');
    END IF;
  END IF;

  IF v_hash IS NOT NULL AND p_current IS NOT NULL
     AND NOT public.password_hash_check(p_phone, p_current, v_hash) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_current');
  END IF;

  INSERT INTO user_passwords (phone, password_hash, must_change_password, updated_at)
  VALUES (p_phone, public.password_hash_make(p_password), COALESCE(p_must_change, FALSE), now())
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

-- ---------------------------------------------------------------------------
-- 5) progress_session_open — كان مساراً بديلاً للتحقق؛ يُوحَّد على نفس الدالة
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6) اختبار ذاتي فوري (اقرأ Messages بعد التنفيذ)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_new      TEXT;
  v_ok_new   BOOLEAN;
  v_ok_bad   BOOLEAN;
  v_ok_old   BOOLEAN;
  v_total    BIGINT := 0;
  v_legacy   BIGINT := 0;
  v_bcrypt   BIGINT := 0;
BEGIN
  -- pgcrypto قد يكون في extensions أو public — نغطّي الحالتين قبل استخدام digest.
  PERFORM set_config('search_path', 'public, extensions', true);

  v_new    := public.password_hash_make('correct horse battery staple');
  v_ok_new := public.password_hash_check('0500000000', 'correct horse battery staple', v_new);
  v_ok_bad := public.password_hash_check('0500000000', 'wrong password', v_new);
  v_ok_old := public.password_hash_check(
                '0123456789', 'probe',
                encode(digest('0123456789::probe', 'sha256'), 'hex'));

  IF v_new NOT LIKE '$2%' OR NOT v_ok_new OR v_ok_bad OR NOT v_ok_old THEN
    RAISE EXCEPTION
      'الاختبار الذاتي فشل: bcrypt=% · صحيح=% · خاطئ=% (يجب false) · قديم=%',
      v_new, v_ok_new, v_ok_bad, v_ok_old;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.user_passwords' INTO v_total;
  EXECUTE $q$SELECT count(*) FROM public.user_passwords WHERE password_hash LIKE '$2%'$q$ INTO v_bcrypt;
  EXECUTE $q$SELECT count(*) FROM public.user_passwords
             WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%'$q$ INTO v_legacy;

  RAISE NOTICE 'bcrypt: يعمل ✅ (صيغة الهاش الجديدة تبدأ بـ $2a$10$)';
  RAISE NOTICE 'الهاش القديم ما زال مقبولاً ✅ — يُرقّى تلقائياً في أول دخول ناجح';
  RAISE NOTICE 'user_passwords: الإجمالي=% · bcrypt=% · سيُرقّى عند الدخول=%',
    v_total, v_bcrypt, v_legacy;
END $$;

COMMIT;

-- ============================================================================
-- التحقّق بعد التنفيذ (بمفتاح anon):
--   POST /rest/v1/rpc/verify_password   {"p_phone":"...","p_password":"..."} → 200 true/false
--   POST /rest/v1/rpc/password_status   {"p_phone":"..."}                    → 200 {...}
--   ثم: سجّل دخول طالب حقيقي مرة واحدة، وأعد رسالة الـNOTICE أعلاه:
--       عدد صفوف bcrypt يجب أن يزيد بمقدار 1 (ترقية تلقائية).
--   تنبيه: 10 محاولات خاطئة لنفس الرقم في 10 دقائق تُقفل المحاولات مؤقتاً —
--          استخدم حساب اختبار عند الفحص.
-- ============================================================================
-- الترتيب المطلوب: 20261023140000_reconcile_schema.sql ثم هذا الملف.
--
-- ⚠️ لا تراجع لهذا الملف:
--   إعادة تعريف الدوال إلى نسختها القديمة (SHA-256 فقط) بعد الترقية ستُفشل
--   دخول كل من رُقّي هاشه — ولا يمكن استرجاع كلمة المرور الأصلية.
--   المسار الآمن الوحيد هو الأمام: أبقِ password_hash_check (تقرأ الصيغتين).
--   وللتحقق من عدم وجود أي هاش قديم متبقٍ بعد فترة:
--     SELECT count(*) FROM public.user_passwords
--      WHERE password_hash NOT LIKE '$2%';   -- يجب أن يقترب من 0
-- ============================================================================

