-- 20261024130000_purge_orphan_passwords.sql
--
-- ═══ المشكلة (مُشخَّصة من الكود + القاعدة الحيّة، 2026-10-24) ═══
--
-- شاشتان تقرآن من جدولين مختلفين:
--   • شاشة الدخول   : registration_by_phone → جدول registrations
--                     → «لا يوجد حساب بهذا الرقم» إن لم تجد صفّاً.
--   • شاشة التسجيل  : password_status → جدول user_passwords
--                     → «هذا الرقم مسجّل مسبقاً بكلمة مرور» إن وجدت صفّاً.
--
-- صفّ كلمة مرور بلا صفّ تسجيل («يتيم») يجعل الرسالتين تتناقضان لنفس الرقم،
-- فيدور الطالب بين الشاشتين بلا مخرج. اليتيم يتولّد كلما حُذف صفّ تسجيل من
-- لوحة Supabase أو بـ SQL مباشر: تنظيف كلمة المرور موجود فقط داخل دالة
-- delete_registration (السطر 200)، ولا شيء يضمنه في مسارات الحذف الأخرى.
--
-- ═══ ما تفعله هذه الهجرة (ولا شيء غيره) ═══
--   1) نسخة احتياطية كاملة للصفوف اليتيمة قبل حذفها
--      → public._orphan_passwords_backup_20261024 (استرجاع بأمر واحد).
--   2) حذف صفوف user_passwords التي لا يقابلها أي صفّ في registrations.
--      المطابقة تشمل الصيغ القديمة (00967… / +967… / 967… / 0…) والأرقام
--      الهندية، فلا يُحذف حساب مسجّل بصيغة مختلفة عن صيغة كلمة مروره.
--   3) trigger على registrations يمنع تكرار المشكلة مستقبلاً من أي مسار حذف.
--
-- ═══ ما لا تمسّه إطلاقاً ═══
--   الإشعارات، push_tokens، student_keys، progress، auth_throttle،
--   developer_sessions — ولا أي جدول آخر. الحذف محصور في user_passwords وحدها.
--   ولا تعديل على أي دالة قائمة (delete_registration / register_student /
--   password_status … تبقى كما هي حرفياً).
--
-- ═══ للتشغيل ═══
--   الصق الملف كاملاً في Supabase → SQL Editor → Run.
--   آمن للتكرار: إعادة تشغيله لا تحذف إلا ما هو يتيم في تلك اللحظة.
--   للإلغاء:  INSERT INTO public.user_passwords (phone, password_hash,
--               must_change_password, updated_at)
--             SELECT phone, password_hash, must_change_password, updated_at
--               FROM public._orphan_passwords_backup_20261024;
--
-- ═══ معاينة قبل الحذف (اختياري) ═══
--   select up.phone, up.updated_at
--     from public.user_passwords up
--    where not exists (select 1 from public.registrations r where r.phone = up.phone)
--      and not exists (
--            select 1 from public.registrations r
--             where length(public.normalize_phone_key(r.phone)) = 9
--               and public.normalize_phone_key(r.phone) = public.normalize_phone_key(up.phone));
-- ════════════════════════════════════════════════════════════════════════════

-- (1) مطبِّع أرقام موحّد: أرقام هندية → لاتينية، حذف الرموز، وتجريد مفتاح الدولة
--     أو الصفر البادئ فقط عندما يبقى 9 أرقام (رقم الجوال اليمني) — لا يغيّر
--     أي رقم سليم أصلاً، لذلك مقارنة الصيغ لا تخلط بين رقمين مختلفين.
CREATE OR REPLACE FUNCTION public.normalize_phone_key(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
           WHEN length(d) = 14 AND left(d, 5) = '00967' THEN substr(d, 6)
           WHEN length(d) = 12 AND left(d, 3) = '967'   THEN substr(d, 4)
           WHEN length(d) = 10 AND left(d, 1) = '0'     THEN substr(d, 2)
           ELSE d
         END
    FROM (
      SELECT regexp_replace(
               translate(coalesce(p_phone, ''),
                         '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
                         '01234567890123456789'),
               '[^0-9]', '', 'g') AS d
    ) s;
$fn$;

REVOKE ALL ON FUNCTION public.normalize_phone_key(TEXT) FROM PUBLIC;

-- (2) التنظيف: نسخة احتياطية ثم حذف — في كتلة واحدة (ذرّية).
DO $do$
DECLARE
  v_total    integer;
  v_regs     integer;
  v_orphans  integer;
  v_kept     integer;
  v_deleted  integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.user_passwords;
  SELECT count(*) INTO v_regs  FROM public.registrations;

  IF v_total = 0 THEN
    RAISE NOTICE 'user_passwords فارغ — لا شيء لتنظيفه.';
    RETURN;
  END IF;

  -- حماية 1: لا تُفرّغ كلمات المرور إذا كان جدول التسجيلات فارغاً (خطأ فادح
  -- أو استعلام على قاعدة خاطئة) — الحذف حينها سيمحو كل كلمات المرور.
  IF v_regs = 0 THEN
    RAISE EXCEPTION 'أُلغِي التنظيف: registrations فارغ بينما user_passwords يحوي % صفاً. راجع القاعدة يدوياً.', v_total;
  END IF;

  CREATE TABLE IF NOT EXISTS public._orphan_passwords_backup_20261024 (
    phone                text PRIMARY KEY,
    password_hash        text,
    must_change_password boolean,
    updated_at           timestamptz,
    backed_up_at         timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public._orphan_passwords_backup_20261024 ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public._orphan_passwords_backup_20261024 FROM anon, authenticated;

  -- مجموعة اليتيمة في هذه اللحظة (لا نعتمد على النسخة الاحتياطية القديمة كي لا
  -- نحذف كلمة مرور أُنشئت بعد تنظيف سابق لنفس الرقم).
  CREATE TEMP TABLE tmp_orphan_phones ON COMMIT DROP AS
  SELECT up.phone
    FROM public.user_passwords up
   WHERE NOT EXISTS (
           SELECT 1 FROM public.registrations r
            WHERE r.phone = up.phone
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.registrations r
            WHERE length(public.normalize_phone_key(up.phone)) = 9
              AND public.normalize_phone_key(r.phone) = public.normalize_phone_key(up.phone)
         );

  SELECT count(*) INTO v_orphans FROM tmp_orphan_phones;
  v_kept := v_total - v_orphans;

  IF v_orphans = 0 THEN
    RAISE NOTICE 'لا توجد كلمات مرور يتيمة: % صفاً كلها تقابل صفوف تسجيل.', v_total;
    DROP TABLE tmp_orphan_phones;
    RETURN;
  END IF;

  -- حماية 2: إذا كان كل شيء «يتيماً» فهذا مؤشر كارثة (صيغة أرقام غير متوقعة).
  IF v_orphans = v_total AND v_total > 20 THEN
    RAISE EXCEPTION 'أُلغِي التنظيف: كل صفوف user_passwords (%) تبدو يتيمة رغم وجود % تسجيلاً. راجع الصيغ يدوياً قبل الحذف.', v_total, v_regs;
  END IF;

  INSERT INTO public._orphan_passwords_backup_20261024 AS b
        (phone, password_hash, must_change_password, updated_at)
  SELECT up.phone, up.password_hash, up.must_change_password, up.updated_at
    FROM public.user_passwords up
   WHERE up.phone IN (SELECT phone FROM tmp_orphan_phones)
  ON CONFLICT (phone) DO NOTHING;

  DELETE FROM public.user_passwords up
   WHERE up.phone IN (SELECT phone FROM tmp_orphan_phones);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DROP TABLE tmp_orphan_phones;

  RAISE NOTICE 'انتهى: حُذفت % كلمة مرور يتيمة. أُبقيت % كلمة مرور لها صفّ تسجيل. النسخة الاحتياطية في public._orphan_passwords_backup_20261024.',
    v_deleted, v_kept;
END;
$do$;

-- (3) منع التكرار: أي حذف لصفّ تسجيل (لوحة Supabase، SQL يدوي، أي مسار) يحذف
--     كلمة مروره إن لم يبقَ له أي صفّ آخر. لا يمسّ أي جدول غير user_passwords.
CREATE OR REPLACE FUNCTION public.registrations_purge_orphan_password()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- يحذف كلمة مرور الصفّ المحذوف فقط إذا لم يبقَ له أي صفّ تسجيل — بمطابقة
  -- الصيغ أيضاً (00967… / +967… / 967… / 0… / أرقام هندية)، فلا يتحوّل الحذف
  -- إلى يتيم جديد ولا يُمحى حساب مسجّل بصيغة أخرى.
  DELETE FROM public.user_passwords up
   WHERE (up.phone = OLD.phone
          OR (length(public.normalize_phone_key(OLD.phone)) = 9
              AND public.normalize_phone_key(up.phone) = public.normalize_phone_key(OLD.phone)))
     AND NOT EXISTS (
           SELECT 1
             FROM public.registrations r
            WHERE r.phone = up.phone
               OR (length(public.normalize_phone_key(up.phone)) = 9
                   AND public.normalize_phone_key(r.phone) = public.normalize_phone_key(up.phone))
         );
  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION public.registrations_purge_orphan_password() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_registrations_purge_orphan_password ON public.registrations;
CREATE TRIGGER trg_registrations_purge_orphan_password
AFTER DELETE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.registrations_purge_orphan_password();

-- (4) تقرير التحقّق — نتيجته تظهر في SQL Editor.
select
  (select count(*) from public.user_passwords)                            as password_rows,
  (select count(*) from public.registrations)                             as registration_rows,
  (select count(*) from public._orphan_passwords_backup_20261024)         as orphans_purged,
  (select count(*) from public.user_passwords up
    where not exists (select 1 from public.registrations r
                       where r.phone = up.phone
                          or (length(public.normalize_phone_key(up.phone)) = 9
                              and public.normalize_phone_key(r.phone) = public.normalize_phone_key(up.phone)))) as orphans_remaining;

select phone, must_change_password, updated_at, backed_up_at
  from public._orphan_passwords_backup_20261024
 order by backed_up_at desc
 limit 200;

-- (المُطبِّع أعلاه للاستخدام الداخلي فقط: REVOKE ALL FROM PUBLIC، بلا منح لأي دور عميل.)
