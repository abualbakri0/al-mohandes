-- ============================================================
-- 20261023010000_registration_read_rpcs.sql
-- دوال قراءة بديلة لبيانات الطلاب (المرحلة 1 — إضافية وآمنة)
-- ------------------------------------------------------------
-- المشكلة قبل هذا الملف:
--   سياسة SELECT على registrations و feedback_messages كانت
--   USING (true) لأي شخص يملك المفتاح العام (وهو مضمَّن في التطبيق).
--   أي مجهول يستطيع سحب: أسماء كل الطلاب + أرقام هواتفهم + كل الملاحظات.
--
-- هذا الملف لا يغلق شيئاً بعد — يضيف فقط الدوال التي سيستخدمها التطبيق،
-- حتى يجري النشر ثم يُغلق الوصول في الملف التالي:
--   20261023011000_lock_pii_reads.sql
--
-- الدوال المضافة هنا:
--   1) registration_by_phone(p_phone) → صف واحد فقط بالرقم المطلوب (تسجيل الدخول)
--   2) register_student(name, phone, dept) → تسجيل طالب جديد (بدل INSERT..RETURNING)
--   3) list_registrations() → كل الطلاب، للمطوّر فقط (dev_token_ok)
--   4) submit_feedback(...) → إرسال ملاحظة (بدل INSERT..RETURNING)
--   5) list_feedback() → كل الملاحظات، للمطوّر فقط
--
-- كل الدوال SECURITY DEFINER: تتجاوز RLS وصلاحيات الأعمدة لأنها تعمل بصلاحية
-- مالك الجداول، لذا بعد إغلاق القراءة في الملف التالي تبقى وحدها القناة
-- المسموحة، وتتحقق بنفسها من توكين المطوّر.
--
-- لا يمسّ هذا الملف إطلاقاً:
--   notifications / معالجات الإشعارات الفورية / push_tokens /
--   web_push_subscriptions / bot_kv / Storage.
--
-- قابل لإعادة التنفيذ بأمان (idempotent).
-- ============================================================


-- ============================================================
-- 1) قراءة سجل طالب واحد بمعرفة رقمه (يستخدمه شاشة الدخول والحارس)
-- ============================================================
-- ملاحظة أمنية: المتصل يجب أن يعرف الرقم مسبقاً، ولا يستطيع سحب القائمة.
-- الحقول المُعادة هي ما يحتاجه التطبيق فقط (لا كلمة مرور، لا أي سرّ).
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
     ORDER BY r.created_at ASC NULLS LAST
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.registration_by_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_by_phone(TEXT) TO anon, authenticated;


-- ============================================================
-- 2) تسجيل طالب جديد
-- ============================================================
-- كان التطبيق يرسل INSERT ثم يطلب RETURNING، وRETURNING يحتاج صلاحية
-- SELECT على الجدول — وهي الصلاحية التي سنسحبها. هذه الدالة تُنشئ الصف
-- وتُعيده في خطوة واحدة، وتفرض is_approved = false دائماً (لا اعتماد ذاتي).
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
BEGIN
  IF v_name = '' OR length(v_phone) < 6 THEN
    RAISE EXCEPTION 'invalid registration data' USING ERRCODE = '22023';
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


-- ============================================================
-- 3) قائمة الطلاب — للمطوّر فقط
-- ============================================================
-- بلا توكين صالح ترفع خطأ 42501 صريحاً: التطبيق يعرض آخر نسخة محفوظة
-- ويظهر في الشبكة سبب الرفض، بدل قائمة فارغة تُوهم بأنه لا يوجد طلاب.
CREATE OR REPLACE FUNCTION public.list_registrations()
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
BEGIN
  IF NOT public.dev_token_ok() THEN
    RAISE EXCEPTION 'developer grant required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT r.id, r.name, r.phone, r.department, r.is_approved, r.created_at
      FROM public.registrations r
     ORDER BY r.created_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_registrations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_registrations() TO anon, authenticated;


-- ============================================================
-- 4) إرسال ملاحظة (بدل INSERT..RETURNING)
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_sender_name  TEXT,
  p_sender_phone TEXT,
  p_message_type TEXT,
  p_subject      TEXT,
  p_message      TEXT
)
RETURNS TABLE (
  id           uuid,
  sender_name  TEXT,
  sender_phone TEXT,
  message_type TEXT,
  subject      TEXT,
  message      TEXT,
  is_read      BOOLEAN,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    TEXT := left(btrim(COALESCE(p_sender_name, '')), 120);
  v_phone   TEXT := NULLIF(left(btrim(COALESCE(p_sender_phone, '')), 20), '');
  v_type    TEXT := COALESCE(NULLIF(btrim(COALESCE(p_message_type, '')), ''), 'other');
  v_subject TEXT := left(btrim(COALESCE(p_subject, '')), 200);
  v_message TEXT := left(COALESCE(p_message, ''), 4000);
BEGIN
  IF v_name = '' OR v_subject = '' OR v_message = '' THEN
    RAISE EXCEPTION 'invalid feedback data' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    INSERT INTO public.feedback_messages (sender_name, sender_phone, message_type, subject, message, is_read)
    VALUES (v_name, v_phone, v_type, v_subject, v_message, FALSE)
    RETURNING feedback_messages.id,
              feedback_messages.sender_name,
              feedback_messages.sender_phone,
              feedback_messages.message_type,
              feedback_messages.subject,
              feedback_messages.message,
              feedback_messages.is_read,
              feedback_messages.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_feedback(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_feedback(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;


-- ============================================================
-- 5) قائمة الملاحظات — للمطوّر فقط
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_feedback()
RETURNS TABLE (
  id           uuid,
  sender_name  TEXT,
  sender_phone TEXT,
  message_type TEXT,
  subject      TEXT,
  message      TEXT,
  is_read      BOOLEAN,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.dev_token_ok() THEN
    RAISE EXCEPTION 'developer grant required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT f.id, f.sender_name, f.sender_phone, f.message_type,
           f.subject, f.message, f.is_read, f.created_at
      FROM public.feedback_messages f
     ORDER BY f.created_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_feedback() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_feedback() TO anon, authenticated;


-- ============================================================
-- 6) تحقق سريع (نفّذه يدوياً بعد التنفيذ)
-- ============================================================
-- SELECT public.registration_by_phone('779809243');   -- صف واحد فقط
-- SELECT * FROM public.list_registrations();          -- 42501 بلا توكين
-- SELECT * FROM public.list_feedback();               -- 42501 بلا توكين
