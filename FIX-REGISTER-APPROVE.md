# إصلاح: «حدث خطأ أثناء التسجيل» + «المطوّر لا يعتمد/يحذف المسجّل»

**التاريخ:** 2026-10-23 · **الحالة:** الإصلاح جاهز، وينقص تنفيذ خطوة واحدة على القاعدة.

---

## 1) السبب الحقيقي (مقيس، لا مُستنتج)

### أ) المطوّر لا يعتمد ولا يحذف — السبب الدقيق: الصلاحية على **العمود `id`**

الملاحظة الأولى كانت صحيحة جزئياً (صلاحيات `UPDATE`/`DELETE` ناقصة فعلاً)، لكنها **ليست السبب الكافي**.
بعد إضافة تلك الصلاحيات بقي الفشل نفسه، والقياس الكامل كشف السبب الحقيقي:

```
PATCH  /rest/v1/registrations?id=eq.…  →  401
{"code":"42501","message":"permission denied for table registrations",
 "hint":"Grant the required privileges to the current role with:
         GRANT SELECT ON public.registrations TO anon;"}
```

في PostgreSQL، الأمر `UPDATE … WHERE id = $1` و`DELETE … WHERE id = $1` **يقرأ العمود
المستخدم في شرط `WHERE`**، فيحتاج `SELECT` على ذلك العمود — لا `UPDATE`/`DELETE` فقط.
وهجرة الخصوصية `20261023011000_lock_pii_reads.sql` سحبت `SELECT` كاملاً من `anon` على
`registrations` و`feedback_messages` ⇒ كل اعتماد/حذف يفشل بـ`42501` **قبل** أن يُفحص RLS
وقبل أن تُقرأ أي بيانات. ولهذا لم تُجدِ صلاحيات `UPDATE`/`DELETE` وحدها.

**الإصلاح النهائي** — `supabase/migrations/20261023170000_registration_write_fix.sql`، ويعالج
المشكلة من طريقين:

| # | الطريقة | لماذا آمنة |
| --- | --- | --- |
| ① | `GRANT SELECT (id)` — صلاحية **عمودية** على عمود واحد فقط | سياسات `SELECT` على الجدولين أُسقطت في هجرة الخصوصية ⇒ `GET /registrations?select=id` يبقى 0 صفوف / `401`. لا أسماء ولا هواتف. وهذا يُصلح أيضاً أي نسخة قديمة (APK v31) على جهاز المطوّر |
| ② | دالتان `SECURITY DEFINER`: `approve_registration(uuid)` و`delete_registration(uuid)` | تعملان بصلاحية مالك الجدول فلا تحتاجان أي `GRANT`، وتتحققان من توكين المطوّر بنفسهما وتردّان `developer grant required` صراحةً بدل نجاح صامت بصفر صفوف. التطبيق يستخدمهما أولاً |

كما أن `delete_registration` تحذف مع الصف كلمة مروره في `user_passwords` ومفاتيح جلسته في
`student_keys` — وإلا بقي الرقم «طالباً عائداً» يرفض التسجيل من جديد (`current_required`).

### ب) «حدث خطأ أثناء التسجيل» للطالب الجديد

الخادم سليم 100% — المقيس على رقم جديد: `register_student` ✅ · `set_password` ✅
`verify_password` ✅ · `progress_session_open` ✅. الفشل من أحد هذين الطريقين:

| السبب | التفصيل |
| --- | --- |
| **نسخة قديمة من الواجهة** (كاش المتصفح أو APK v31) | الحزمة القديمة تُنفّذ `INSERT ... RETURNING`، و`RETURNING` يحتاج `SELECT` وهو مسحوب منذ هجرة القراءة ⇒ `401 42501`. لا يُكتب صف أصلاً. |
| **الرقم يملك كلمة مرور مسبقاً** (طالب عائد) | `register_student` ينجح، ثم يرد `set_password` بـ`current_required`؛ فيبقى صفّ «بانتظار الموافقة» بلا كلمة مرور، ويظهر النص العام. |

---

## 2) الخطوة الوحيدة المطلوبة منك (SQL)

> **مهم:** هذه هي الخطوة التي لم تُنفَّذ بعد. القياس الآن (2026-10-23) يقول صراحةً:
> `registrations`/`feedback_messages` → `DENIED:table (42501)`، والدالتان
> `approve_registration`/`delete_registration` **غير موجودتين**. أي أن الإصلاح جاهز في الكود
> لكنه لم يصل إلى القاعدة.

افتح **Supabase Dashboard → SQL Editor** (مشروع `wulycdwgvpriptzubazi`)، والصق محتوى هذا
الملف كاملاً ثم **Run**:

```
supabase/migrations/20261023170000_registration_write_fix.sql
```

يفعل الملف:

1. `GRANT SELECT (id)` على `registrations` و`feedback_messages` — وهذا هو **مفتاح الحل**:
   شرط `WHERE id = …` لا يعمل بدونهما.
2. `GRANT UPDATE, DELETE` على الجدولين، و`INSERT, UPDATE` على `app_settings`.
3. يُنشئ `approve_registration(uuid)` و`delete_registration(uuid)` (SECURITY DEFINER).
4. **تحقق ذاتي**: أي صلاحية ناقصة تُفشل التنفيذ وتُسمّى بالعربية — لا نجاح جزئي صامت.
5. يؤكد أن `SELECT` الكامل ما زال مسحوباً (بيانات الطلاب غير مقروءة بالمفتاح العام).

> لا تستخدم `20261023160000_restore_dev_write_grants.sql` — مُستبدل بهذا الملف (كان يمنح
> `UPDATE`/`DELETE` دون `SELECT(id)` فلا يحل شيئاً). الملف الجديد idempotent: تنفيذه مرتين آمن.

---

## 3) التحقق (دقيقة واحدة)

```bash
node scripts/diagnose-grants.mjs
```

المتوقع بعد التنفيذ:

```
table                  INSERT                 UPDATE                 DELETE
registrations          ok (rejected by type)  ok (0 rows)            ok (0 rows)
feedback_messages      ok (rejected by type)  ok (0 rows)            ok (0 rows)
app_settings           ok (rejected by type)  ok (0 rows)            ok (0 rows)

developer write RPCs:
  approve_registration     42501 {"message":"developer grant required"}   ← موجودة وتعمل
  delete_registration      42501 {"message":"developer grant required"}   ← موجودة وتعمل

privacy check (must stay 401 — no student data readable):
  GET registrations          401
```

ثم من التطبيق كمطوّر: «المسجلون» → اعتماد/حذف ⇒ ينجح فوراً (لا حاجة لإعادة نشر الويب).

للتأكد أن قراءة الطلاب ما زالت مغلقة (يجب أن يبقى `401`):

```bash
node -e "const fs=require('fs');const e={};for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)e[m[1]]=m[2].trim()}fetch(e.VITE_SUPABASE_URL+'/rest/v1/registrations?select=name,phone',{headers:{apikey:e.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+e.VITE_SUPABASE_ANON_KEY}}).then(async r=>console.log(r.status,await r.text()))"
```

---

## 4) الطلاب الذين يرون «خطأ أثناء التسجيل»

بعد الإصلاح صارت الرسالة تشرح السبب بدل النص العام:

| الرسالة الجديدة | المعنى | ما تفعله |
| --- | --- | --- |
| «هذه النسخة من التطبيق قديمة ولم تعد تملك صلاحية الكتابة…» | الطالب على حزمة قديمة/APK v31 | حدّث الصفحة (`Ctrl+Shift+R`) على الويب، أو ثبّت `Almohanndes-release-v32-signed.apk` |
| «هذا الرقم مسجّل مسبقاً بكلمة مرور…» | الطالب عائد (حسابه يحمل كلمة مرور) | يسجّل الدخول، أو تُعيد له تعيين كلمة المرور من «المسجلون» |
| «أنت غير متصل بالإنترنت…» | انقطاع شبكة فعلي | يعيد المحاولة بعد عودة الاتصال |
| «انتهت صلاحية دخول المطوّر…» (في لوحة المطوّر) | التوكين الموقّع في `localStorage` مفقود أو انتهت مدته (30 يوماً) أو صادر بكلمة سر قديمة | «خروج» ثم إدخال كلمة سر المطوّر من جديد ⇒ يُصدر الخادم توكيناً جديداً وتنجح الكتابة فوراً |

---

## 5) ما تغيّر في الكود

| الملف | التغيير |
| --- | --- |
| `supabase/migrations/20261023170000_registration_write_fix.sql` | **الإصلاح الفعلي (جديد)** — `GRANT SELECT (id)` + `UPDATE/DELETE` + الدالتان `approve_registration` / `delete_registration` |
| `supabase/migrations/20261023160000_restore_dev_write_grants.sql` | مُستبدل (يبقى للأرشيف فقط — لا تنفّذه) |
| `src/lib/api.ts` | `deleteRegistration` / `approveRegistration` تستخدمان الـRPC أولاً ثم الكتابة القديمة · `DEV_GRANT_EXPIRED_MESSAGE` لرفض التوكين · `describeWriteError` / `describeRegistrationError` · `addRegistration` يفحص `password_status` قبل الإدراج فلا يُنشئ صفاً وهمياً |
| `src/components/RegistrationGate.tsx` · `RegistrationForm.tsx` | رسائل محدّدة بدل «حدث خطأ أثناء التسجيل» |
| `src/components/RegistrationsView.tsx` | اعتماد/حذف/إعادة تعيين لم تعد تبتلع الأخطاء — إشعار بالسبب |
| `scripts/diagnose-grants.mjs` · `diagnose-signup.mjs` · `diagnose-legacy-insert.mjs` | أدوات قياس دائمة |

**ملاحظة أمنية:** منح `UPDATE/DELETE` لا يفتح شيئاً — كل سياسة مقيّدة بـ`dev_token_ok()`
(توقيع HMAC يُتحقق منه داخل Postgres من `x-dev-token`). بدون توكن صالح: صفر صفوف تتأثر،
ولا تُقرأ أي بيانات.
