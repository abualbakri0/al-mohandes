# SECURITY — نموذج حماية تطبيق «المهندس»

هذا الملف يوثّق **ما هو محمي فعلياً**، و**ما يحتاج إجراءً منك**، و**ما هي الثغرات
المتبقية المقبولة**. لا يحتوي أي سرّ.

---

## 1) نموذج الثقة (Trust model)

| الطبقة | من يستطيع القراءة | من يستطيع الكتابة |
|---|---|---|
| محتوى التطبيق (محاضرات/تكاليف/امتحانات/إشعارات/مراجع/خطة دراسة) | الجميع (المفتاح العام) | **المطوّر فقط** — توكين موقّع في الهيدر `x-dev-token` |
| `registrations` | الجميع (القراءة) | إضافة: أي طالب · تعديل/حذف: المطوّر فقط |
| `feedback_messages` | الجميع (القراءة) | إرسال: أي طالب · تعديل/حذف: المطوّر فقط |
| `app_settings` | أعمدة العرض فقط | المطوّر فقط + `change_dev_code` RPC |
| `user_passwords` | لا أحد (لا سياسة قراءة) | `set_password` RPC فقط |
| `student_keys` / `auth_throttle` | لا أحد (REVOKE) | دوال SECURITY DEFINER فقط |
| `push_tokens` / `web_push_subscriptions` / `bot_kv` | كما هو (لم يُمسّ) | كما هو (لم يُمسّ) |

**كيف يُثبت العميل أنه المطوّر؟**
1. يدخل رمز المطوّر → `verify_developer_code(p_code)` (SECURITY DEFINER).
2. تُرجع الدالة توكناً = `expiry.HMAC-SHA256(expiry|dev-grant, dev_password)`.
3. التوكين يُخزَّن في `localStorage` تحت `dev_grant`.
4. `src/lib/supabase.ts` يحقن كل طلب بـ `x-dev-token` (فقط عند وجود توكين).
5. RLS تنادي `public.dev_token_ok()` التي تقرأ الهيدر وتتحقق من HMAC.

النتيجة: تعديل `localStorage` أو إزالة الواجهة لا يمنح كتابة — الرفض في Postgres.

---

## 2) لماذا لا يتأثر الطلاب ولا نظام الإشعارات

- **القراءة**: كل سياسات SELECT بقيت `USING (true)` كما هي.
- **الإشعارات**: `push_tokens`، `web_push_subscriptions`، `bot_kv`،
  `supabase/functions/push-notify`، وكل الهجرات `2026101*`/`2026102*` الخاصة
  بالإرسال **لم تُعدَّل**. أي كتابة يقوم بها البوت أو الدوال تستخدم
  `service_role` الذي يتجاوز RLS.
- **تسجيل الطالب** و**إرسال الملاحظة** يبقيان مفتوحين (وظيفة الطالب).
- **تقدّم الطالب** (تكاليف/مذاكرة) يمر عبر RPCs معزولة بمفتاح لكل طالب — لم يُمسّ.

---

## 3) قائمة إجراءات مطلوبة منك (بالترتيب)

### 3.0 الحالة المُتحقَّق منها لحظياً (فحص فعلي، لا تخمين)

| البند | النتيجة |
|---|---|
| الهجرة على قاعدة البيانات | ❌ **لم تُنفَّذ بعد** — استعلام PostgREST يُرجع `PGRST202: Could not find the function public.dev_token_ok` |
| الكود في المشروع | ✅ جاهز (typecheck + build + فحص الأسرار ناجحة) |
| ملفات keystore في فهرس Git | ✅ نظيفة (خرجت من التتبع، وبقيت على القرص فالبناء يعمل) |
| ملفات keystore في **تاريخ** Git | ❌ موجودة في 4 commits من أول commit: `android/almohanndes.keystore`، `android/keystore.properties`، `احتفظ-بهذا-مجلد/…`، `توقيع المهندس/…` |
| المستودع | ❌ **عام (public)** — `github.com/abualbakri0/al-mohandes` يُرجع 200 |
| نسخ/نجوم/متابعون | ✅ 0 forks · 0 stars · 0 watchers (لم يُنسخ المستودع) |
| `.env` في التاريخ | ✅ لم يُرفع أبداً |

### 3.1 فوري — تنفيذ الهجرة
```
المسار: supabase/migrations/20261022120000_harden_write_access.sql
```
انسخ كامل محتواه والصقه في Supabase → SQL Editor → Run. آمنة للتكرار.
بعدها:
- سجّل دخول المطوّر في التطبيق (رمز المطوّر) ثم أضف محاضرة تجريبية → يجب أن تنجح.
- جرّب حذف محاضرة، تعديل امتحان، نشر إشعار → يجب أن تنجح.
- **أعد بناء APK** (`npm run build` ثم بناء أندرويد) لأن نسخة APK القديمة لا ترسل
  الهيدر، فتفقد القدرة على الكتابة (القراءة تبقى تعمل).

### 3.1.1 اختياري — إغلاق دلو المراجع
بعد نجاح 3.1، نفّذ `RUN-THIS-OPTIONAL-harden-storage.sql` ثم ارفع PDF تجريبياً.
إن فشل الرفع، طبّق «التراجع» المكتوب داخل الملف (سطران) — لا شيء آخر يتأثر.

### 3.2 فوري — الأنبوب (P0): مفتاح التوقيع مسرَّب
المفتاح `android/almohanndes.keystore` + كلمة سرّه كانا في **تاريخ** المستودع العام.
أي شخص يستطيع توقيع APK باسمك ويجتاز فحص التوقيع داخل التطبيق.

اختر مساراً واحداً:
- **أ) الأفضل**: Google Play + **Play App Signing** (مفتاحك القديم لا يعود مهماً).
- **ب) الأسرع**: مفتاح جديد + **تغيير `applicationId`** (تطبيق جديد؛ القديم يُهمَل).
- **ج) الأقل ألماً**: مفتاح جديد بنفس `applicationId` — **كل مستخدم يجب أن يحذف
  التطبيق ويعيد تثبيته** (أندرويد يرفض التحديث لو اختلف التوقيع).

الأوامر:
```powershell
keytool -genkeypair -v -keystore android\almohanndes-new.keystore `
  -alias almohanndes -keyalg RSA -keysize 4096 -validity 10000
# ثم حدّث android/keystore.properties (محلياً فقط، غير متتبَّع في Git)
# ثم أعد بناء APK وأعد نشره عبر البوت
```

### 3.3 فوري — تنظيف تاريخ Git (الفهرس نظيف مسبقاً، المطلوب مسح التاريخ)
الملفان خرجا من الفهرس بالفعل (`git rm --cached` جاهز للـcommit)، لكن **التاريخ**
ما زال يحملهما — والمستودع عام. الخطوات:

```powershell
# 0) نسخة احتياطية كاملة قبل أي شيء (إلزامي)
git clone --mirror https://github.com/abualbakri0/al-mohandes.git ..\backup-al-mohandes.git

# 1) اجعل المستودع خاصاً الآن (يوقف أي نسخ جديد فوراً)
#    GitHub → Settings → General → Danger Zone → Change visibility → Private

# 2) امسح الملفات من كل التاريخ
pip install git-filter-repo
git clone https://github.com/abualbakri0/al-mohandes.git ..\clean && cd ..\clean
git filter-repo --force --invert-paths `
  --path "android/almohanndes.keystore" `
  --path "android/keystore.properties" `
  --path "احتفظ-بهذا-مجلد/almohanndes.keystore" `
  --path "احتفظ-بهذا-مجلد/keystore.properties" `
  --path "توقيع المهندس/almohanndes.keystore" `
  --path "توقيع المهندس/keystore.properties" `
  --path "توقيع المهندس/mapping-release-v26"

# 3) تحقّق: يجب ألا يُرجع أي سطر
git log --all --name-only --pretty=format: -- '*keystore*'

# 4) ادفع بالقوة (يُعيد كتابة الـhashes — كل نسخة عندك يجب إعادة استخراجها)
git remote add origin https://github.com/abualbakri0/al-mohandes.git
git push --force --all
git push --force --tags
```

بعد ذلك: احذف النسخ القديمة من أجهزتك واستخرج نسخة جديدة، ولا تدفع من مجلد
`project` القديم قبل `git fetch --all && git reset --hard origin/main`.
(0 forks حالياً — لا حاجة لمراسلة GitHub لإبطال نسخ.)


### 3.4 فوري — تدوير الأسرار
- `dev_password`: شاشة الإعدادات → تغيير الرمز (أو SQL: `change_dev_code`).
- `BOT_TOKEN`: BotFather → `/revoke`.
- `SUPABASE_SERVICE_KEY`: لا تضعها في التطبيق إطلاقاً؛ فقط في Railway.
- أي كلمة سر مستخدم كانت مكتوبة في التاريخ: أعد تعيينها.

---

## 4) حارس تلقائي

```powershell
node scripts/check-secrets.mjs    # يفشل إذا وُجد سرّ في ملفات Git المتتبَّعة
```
و GitHub Actions يشغّله مع `npm run typecheck` عند كل دفع
(`.github/workflows/security.yml`).

> ملاحظة: الفحص يمرّ الآن لأن ملفات keystore خرجت من **الفهرس**، لكنه لا يفحص
> **التاريخ** — فتاريخ المستودع ما زال يحملها حتى تنفّذ 3.3.

---

## 5) ثغرات متبقية معروفة (مقبولة حالياً — تحتاج قراراً لاحقاً)

| # | الوصف | الأثر | العلاج المقترح |
|---|---|---|---|
| 1 | المفتاح العام (`anon`) مضمَّن في التطبيق | قراءة كل المحتوى | طبيعي في تصميم Supabase بلا تسجيل دخول |
| 2 | رقم هاتف الطلاب مقروء للجميع في `registrations` | خصوصية | RPC يعيد أرقاماً مُقنَّعة + تعديل شاشة التسجيلات |
| 3 | كلمة المرور = SHA-256(phone::password) بلا bcrypt | تخمين أسرع عند تسريب الهاش | نقل التجزئة إلى `pgcrypto crypt()` |
| 4 | لا يوجد Play Integrity / SSL pinning | تشغيل على جهاز معدّل | Play Integrity + شهادة مثبَّتة |
| 5 | الحزمة الويب مقلَّصة (esbuild) فقط | قراءة الكود | `javascript-obfuscator` عند البناء (يحتاج اختبار) |
| 6 | `push_tokens` مفتوح للكتابة | حذف رموز إشعارات (تعطيل إشعارات) | لم يُمسّ احتراماً لطلبك — يُنصح بتقييده لاحقاً |
| 7 | حساب في حالة «يجب تغيير كلمة المرور» يقبل تعيين كلمة مرور جديدة بلا كلمة حالية | اختطاف خلال نافذة قصيرة بعد إعادة تعيين المطوّر | يُغلق نهائياً بإصدار «جلسة تغيير» قصيرة العمر بعد `verify_password` |

---

## 6) ما لا يفعله أي كود

لا يوجد سطر برمجي يستطيع إصلاح مفتاح توقيع مسرَّب، ولا منع نسخ موقع يعمل بمفتاح
عام. الحماية الحقيقية = **مفتاح جديد + تنظيف التاريخ + كتابة مشروطة من الخادم**،
وهذا ما تم هنا باستثناء ما يحتاج قرارك في القسم 3.
