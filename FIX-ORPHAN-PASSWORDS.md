# إصلاح: رسالتان متناقضتان لنفس الرقم («لا يوجد حساب» مقابل «مسجّل مسبقاً»)

**التاريخ:** 2026-10-24 · **الحالة:** الكود جاهز (typecheck + eslint نظيفان) + هجرة واحدة تحتاج تنفيذاً واحداً على القاعدة.

---

## 1) العَرَض

- طالب جديد تماماً يرى في شاشة التسجيل: «هذا الرقم مسجّل مسبقاً بكلمة مرور…».
- طالب مسجّل فعلاً يرى في شاشة الدخول: «لا يوجد حساب بهذا الرقم…».
- وقد يدور نفس الطالب بين الشاشتين بلا مخرج (كل واحدة تنفيه إلى الأخرى).

## 2) السبب الجذري (مقيس على الكود، لا مُستنتَج)

الشاشتان تقرآن من **جدولين مختلفين**:

| الشاشة | الدالة | الجدول | متى تُطلق رسالتها |
| --- | --- | --- | --- |
| الدخول | `registration_by_phone` | `registrations` | لا صفّ تسجيل بهذا الرقم ⇒ «لا يوجد حساب» |
| التسجيل | `password_status` | `user_passwords` | يوجد صفّ كلمة مرور ⇒ «مسجّل مسبقاً» |

فإذا وُجد **صفّ كلمة مرور بلا صفّ تسجيل (يتيم)** تناقضت الرسالتان لنفس الرقم.
ويتولّد اليتيم كلما حُذف صفّ تسجيل من لوحة Supabase أو بـ SQL مباشر، لأن تنظيف
كلمة المرور موجود **فقط** داخل دالة `delete_registration` (سطر 200 من هجرة
`20261024120000`)، ولا شيء يضمنه في مسارات الحذف الأخرى.

سبب ثانٍ مساعد (أُصلح أيضاً): `fetchPasswordStatus` تعمل **fail-closed** — أي
تعثّر شبكي/خادمي عابر في `password_status` كان يُرجع `hasPassword: true`
احتياطاً، فيظهر «مسجّل مسبقاً بكلمة مرور» لرقم جديد تماماً بلا أي كلمة مرور.

مسبار حيّ (مفتاح `anon`، 2026-10-24): `registration_by_phone` = 0 صف لرقم جديد
مع `password_status.has_password = false` ⇒ الحالة **سليمة** للأرقام الجديدة،
والخلل محصور في أرقام محدّدة لها صفوف يتيمة أو تعثّر نداء عابر.

## 3) ما تمّ تنفيذه

### (أ) قاعدة البيانات — `supabase/migrations/20261024130000_purge_orphan_passwords.sql`

1. نسخة احتياطية كاملة للصفوف اليتيمة في `public._orphan_passwords_backup_20261024`
   (RLS مفعّلة، ولا وصول لأي دور عميل) — الاسترجاع بأمر واحد.
2. حذف صفوف `user_passwords` بلا صفّ تسجيل مقابل — **بمطابقة الصيغ** أيضاً
   (`00967…` / `+967…` / `967…` / `0…` / أرقام هندية) عبر
   `public.normalize_phone_key()`، فلا يُمحى حساب مسجّل بصيغة مختلفة.
3. حمايتان تُلغيَان التنفيذ بدل الحذف الخاطئ: `registrations` فارغ، أو كل الصفوف
   تبدو يتيمة (> 20 صفاً).
4. `trigger` على `registrations` (`AFTER DELETE`) يحذف كلمة مرور الصفّ المحذوف
   إن لم يبقَ له صفّ آخر بأي صيغة ⇒ **لا يتولّد يتيم جديد من أي مسار حذف**.

### (ب) الواجهة — `src/lib/api.ts` (الملف الوحيد المعدَّل)

- `PasswordStatus.confirmed`: `false` عندما تكون `hasPassword` مجرد تقدير
  احتياطي لا إجابة خادم.
- `addRegistration`: إعادة محاولة واحدة عند التعثّر، ولا تُطلق
  `EXISTING_ACCOUNT_MESSAGE` إلا على إجابة **مؤكَّدة**؛ وإن بقي الحال مجهولاً
  تظهر رسالة صادقة جديدة `ACCOUNT_STATUS_UNKNOWN_MESSAGE` («تعذّر التحقق… لم
  يُنشأ أي حساب بعد») ولا يُنشأ أي صفّ ولا يُقال «مسجّل مسبقاً» بلا دليل.
- لم يُغيَّر شيء في مسار الدخول ولا في تصنيف الأخطاء الأخرى.

## 4) الخطوة الوحيدة المتبقية على القاعدة

الصق ملف الهجرة كاملاً في **Supabase → SQL Editor → Run** (لا يوجد مفتاح
`service_role` محلياً، والحذف لا يمكن تنفيذه إلا من صلاحية owner):

```
supabase/migrations/20261024130000_purge_orphan_passwords.sql
```

النتيجة المتوقعة في آخر الملف:

- `password_rows` / `registration_rows`: أحجام الجدولين.
- `orphans_purged`: عدد ما حُذف الآن (+ كل ما سبق في نسخ سابقة).
- `orphans_remaining`: يجب أن يكون **0**.
- جدول بالصفوف المحذوفة (`phone, must_change_password, updated_at, backed_up_at`).

## 5) التحقق بعد التنفيذ

```sql
-- يجب أن يعود فارغاً
select up.phone from public.user_passwords up
 where not exists (select 1 from public.registrations r where r.phone = up.phone)
   and not exists (select 1 from public.registrations r
                    where length(public.normalize_phone_key(up.phone)) = 9
                      and public.normalize_phone_key(r.phone) = public.normalize_phone_key(up.phone));
```

ثم اختبار بشري: رقم كان «يتيماً» ⇒ دخول: «لا يوجد حساب» + تسجيل: ينجح ويُنشئ
صفاً «بانتظار الموافقة» (لا رسالة «مسجّل مسبقاً»).

## 6) التراجع

```sql
insert into public.user_passwords (phone, password_hash, must_change_password, updated_at)
select phone, password_hash, must_change_password, updated_at
  from public._orphan_passwords_backup_20261024
on conflict (phone) do nothing;
```

## 7) ما لم يُلمس (بطلب صريح)

الإشعارات و`push_tokens` و`student_keys` و`progress` و`auth_throttle` وكل
الدوال القائمة (`register_student` / `delete_registration` / `password_status`
/ `verify_password` / `progress_session_open`) — بلا أي تعديل. الحذف محصور في
جدول `user_passwords`.

## 8) تحقّق آلي قبل اللمس

الهجرة نُفِّذت فعلياً على Postgres حقيقي داخل WASM (PGlite) بسيناريوهات: مطابقة
حرفية، صيغة `+967`، أرقام هندية، يتيم عادي، يتيم هندي، إعادة تشغيل، حذف تسجيل
بصيغة مختلفة، وحماية الجدول الفارغ ⇒ **6/6 نجحت**.
