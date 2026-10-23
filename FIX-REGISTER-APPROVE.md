# إصلاح: «حدث خطأ أثناء التسجيل» + «المطوّر لا يعتمد/يحذف المسجّل»

**التاريخ:** 2026-10-23 · **الحالة:** الإصلاح جاهز، وينقص تنفيذ خطوة واحدة على القاعدة.

---

## 1) السبب الحقيقي (مقيس، لا مُستنتج)

### أ) المطوّر لا يعتمد ولا يحذف

`registrations` و`feedback_messages` و`app_settings` أُنشئت بملفات هجرة، فلم تصلها صلاحيات
`UPDATE`/`DELETE`/`INSERT` التي تمنحها Supabase افتراضياً للجداول الجديدة.
سياسات RLS الخاصة بالمطوّر موجودة، لكن **RLS لا تُفحص إذا كانت صلاحية الجدول نفسها غير ممنوحة**؛
لذلك يرد PostgREST قبلها:

```
PATCH  /rest/v1/registrations  →  401 {"code":"42501","message":"permission denied for table registrations"}
DELETE /rest/v1/registrations  →  401 42501
```

ولهذا كان الزر يبدو كأنه «لا يفعل شيئاً» (كانت الواجهة تبتلع الخطأ صامتاً).

### ب) «حدث خطأ أثناء التسجيل» للطالب الجديد

الخادم سليم 100% — المقيس على رقم جديد: `register_student` ✅ · `set_password` ✅
`verify_password` ✅ · `progress_session_open` ✅. الفشل من أحد هذين الطريقين:

| السبب | التفصيل |
| --- | --- |
| **نسخة قديمة من الواجهة** (كاش المتصفح أو APK v31) | الحزمة القديمة تُنفّذ `INSERT ... RETURNING`، و`RETURNING` يحتاج `SELECT` وهو مسحوب منذ هجرة القراءة ⇒ `401 42501`. لا يُكتب صف أصلاً. |
| **الرقم يملك كلمة مرور مسبقاً** (طالب عائد) | `register_student` ينجح، ثم يرد `set_password` بـ`current_required`؛ فيبقى صفّ «بانتظار الموافقة» بلا كلمة مرور، ويظهر النص العام. |

---

## 2) الخطوة الوحيدة المطلوبة منك (SQL)

افتح **Supabase Dashboard → SQL Editor**، والصق محتوى الملف كاملاً:

```
supabase/migrations/20261023160000_restore_dev_write_grants.sql
```

ثم **Run**. الملف يقوم بأربعة أشياء:

1. `GRANT UPDATE, DELETE` على `registrations` و`feedback_messages`.
2. `GRANT UPDATE, INSERT` على `app_settings`.
3. يُنشئ سياسات المطوّر الناقصة فقط (لا يلمس الموجود).
4. **تحقق ذاتي**: إن بقيت صلاحية ناقصة سيفشل التنفيذ ويطبع اسمها — أي لا نجاح جزئي صامت.

كما يُبقي `SELECT` مسحوباً (بيانات الطلاب تبقى غير مقروءة بالمفتاح العام)، ويحذف صفوف التشخيص
التي أنشأها الفحص الآلي (رقم `700000000`).

> بديل: `supabase db push` إن كنت تستخدم Supabase CLI. الملف idempotent — تنفيذه مرتين آمن.

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
app_settings           ok (0 rows)            ok (0 rows)            ok (0 rows)
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

---

## 5) ما تغيّر في الكود

| الملف | التغيير |
| --- | --- |
| `supabase/migrations/20261023160000_restore_dev_write_grants.sql` | الإصلاح الأساسي (جديد) |
| `src/lib/api.ts` | `describeWriteError` / `describeRegistrationError` · `addRegistration` يفحص `password_status` قبل الإدراج فلا يُنشئ صفاً وهمياً · تمرير `reason` الحقيقي |
| `src/components/RegistrationGate.tsx` · `RegistrationForm.tsx` | رسائل محدّدة بدل «حدث خطأ أثناء التسجيل» |
| `src/components/RegistrationsView.tsx` | اعتماد/حذف/إعادة تعيين لم تعد تبتلع الأخطاء — إشعار بالسبب |
| `scripts/diagnose-grants.mjs` · `diagnose-signup.mjs` · `diagnose-legacy-insert.mjs` | أدوات قياس دائمة |

**ملاحظة أمنية:** منح `UPDATE/DELETE` لا يفتح شيئاً — كل سياسة مقيّدة بـ`dev_token_ok()`
(توقيع HMAC يُتحقق منه داخل Postgres من `x-dev-token`). بدون توكن صالح: صفر صفوف تتأثر،
ولا تُقرأ أي بيانات.
