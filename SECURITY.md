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
| الهجرة على قاعدة البيانات | ✅ **منفّذة** — `registration_by_phone` يُرجع 200، و`list_registrations`/`list_feedback` يرفعان `42501` بلا توكين مطوّر |
| قراءة `registrations` بمفتاح anon | ✅ **مغلقة** — `GET /rest/v1/registrations` → `401` + `42501` (permission denied) |
| قراءة `feedback_messages` بمفتاح anon | ✅ **مغلقة** — `GET /rest/v1/feedback_messages` → `401` + `42501` |
| `register_student` برقم/اسم فارغ | ✅ يرفض بـ `400` + `22023` (تحقق داخلي يعمل) |
| نظام الإشعارات | ✅ لم يُمسّ — `GET /rest/v1/notifications` → 200 كما كان |
| ملفات keystore في فهرس Git | ✅ نظيفة (`.old` أُخرج من التتبع وحُذف من القرص؛ `.bak` مستثنى) |
| ملفات keystore في **تاريخ** Git | ✅ **نظيفة** — مُسح التاريخ بالكامل (`filter-repo`) ودُفع قسرياً؛ صفر كائنات keystore (تفاصيل 3.3) |
| المستودع | ✅ **خاص (private)** — `api.github.com/repos/abualbakri0/al-mohandes` يُرجع 404 |
| مفتاح التوقيع | ✅ جديد — بصمة `1a:9e:99:8d:…:c7:7c` (القديم `7B:9F:7C:1B:…` ميت) |
| كلمة سر المفتاح الجديد | ✅ أُعيد تدويرها (32 حرفاً عشوائياً) — كانت = بادئة كلمة السر المسرَّبة، وأُبطلت |
| APK v31 | ✅ `versionCode=31` · موقّع بالمفتاح الجديد · بصمة الملف `56E9DBE2…` ومطابقة تماماً للملف المنشور على البوت |
| APK v32 | ✅ `versionCode=32` · نسخة release (R8 + shrink + zipalign + `debuggable=false`) · توقيع v2 · شهادة `1a:9e:99:8d:…:c7:7c` · SHA-256 للملف `F061FC8E96080B7795E62A3B7AFF99884DCB7CEFBEB5108D6828E7CD96229D48` · **مقيس**: الحزمة داخل APK تحوي `unregister_push_token` (٢×) و`unregister_web_push` (١×) ⇒ مسار الإلغاء الجديد مشمول فعلاً — 2026-10-23 |
| `.env` في التاريخ | ✅ لم يُرفع أبداً |
| `push_tokens` بمفتاح anon | ✅ **مغلقة** — `GET` → `401` + `42501` · `POST` (تسجيل جهاز) → يعمل · `DELETE`/`UPDATE` **بفلتر** → `401` (لم يعد ممكناً تعطيل إشعارات جهاز آخر) — قياس 2026-10-23 |
| `user_passwords` بمفتاح anon | ✅ **مغلقة** — `GET` → `401` + `42501` · `INSERT` → `401` · والمنطق كله عبر RPC (`password_status` → `200` مقيس) |
| `web_push_subscriptions` بمفتاح anon | ✅ **مغلقة** — `GET` → `401` + `42501` · الكتابة (تسجيل/إلغاء) تبقى |
| `app_password_hash()` | ⚠️ موجودة في القاعدة وغير معرَّفة في أي هجرة → عُوِّضت بهجرة مصالحة (3.6) |
| إلغاء تسجيل جهاز من العميل | ✅ عُوِّض بعد إغلاق الفلتر — RPC `unregister_push_token` / `unregister_web_push` (3.6) |
| `auth_throttle` / `app_settings` بمفتاح anon | ✅ مغلقة — `401` + `42501` |

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

### 3.1.2 تشخيص: «المطوّر لا يستطيع الإضافة/النشر» بعد الهجرة

هذا عرض جانبي متوقَّع، وسببه أن **ملفات الواجهة التي يعمل بها التطبيق قديمة**
(بُنيت قبل إضافة الهيدر `x-dev-token`)، لا عطل في قاعدة البيانات.

| العَرَض | السبب | الحل |
|---|---|---|
| يفشل من داخل الـAPK فقط، والموقع يعمل | مجلد `android/app/src/main/assets/public` لم يُحدَّث (بناء Gradle وحده لا ينسخ الواجهة) | `npm run sync:android` ثم بناء الـAPK |
| يفشل من الموقع أيضاً | حزمة قديمة في الكاش (PWA/Service Worker) | `Ctrl+Shift+R` أو نافذة خاصة |
| يفشل بعد 30 يوماً من تسجيل الدخول | انتهت صلاحية توكين المطوّر | أعد إدخال رمز المطوّر في الإعدادات |
| يفشل بعد تغيير رمز المطوّر | التوكين القديم بُرمِز بالرمز القديم | أعد إدخال الرمز الجديد |

تحقّق سريع في الكونسول (داخل التطبيق أو المتصفح):
```js
JSON.parse(localStorage.getItem('dev_grant') || 'null') // يجب أن يكون نصاً مثل "1799...af3c"
window.__devAuthBlocked   // يُملأ عند كل كتابة مرفوضة: {method, url, status, at}
```
`status: 401/403` مع `url` يحتوي `/rest/v1/lectures` ⇒ الخادم رفض الكتابة لأن
الهيدر غائب/منتهٍ. إن كان `dev_grant` موجوداً والرفض ما زال يحدث، فالحزمة التي
تعمل قديمة: أعد البناء بثلاثة أوامر بالترتيب:
```powershell
npm run build
npx cap copy android
cd android; .\gradlew.bat assembleRelease
```

> **قاعدة دائمة:** أي تغيير في `src/` لا يصل إلى التطبيق إلا عبر `cap copy`
> ثم إعادة بناء Gradle. لتفادي النسيان يوجد الآن `npm run sync:android`.

### 3.1.3 فوري — إغلاق قراءة بيانات الطلاب (تسريب PII)

كان أي شخص يملك المفتاح العام (وهو داخل APK) يستطيع سحب **كل** صفوف
`registrations` (اسم + هاتف + قسم + حالة الاعتماد) و**كل** صفوف
`feedback_messages` (اسم المرسل + نص الملاحظة) — لأن سياسة SELECT كانت
`USING (true)`. هذا الملفان يُغلقان ذلك نهائياً:

| # | الملف | ماذا يفعل | متى |
|---|---|---|---|
| 1 | `supabase/migrations/20261023010000_registration_read_rpcs.sql` | يضيف 5 دوال بديلة (قراءة صف واحد بالهاتف، تسجيل طالب، قائمة الطلاب للمطوّر، إرسال/قراءة الملاحظات). **لا يغلق شيئاً** ولا يكسر أي نسخة. | الآن |
| 2 | `supabase/migrations/20261023011000_lock_pii_reads.sql` | يسقط سياسات SELECT ويسحب صلاحية القراءة من `PUBLIC, anon, authenticated`. | **بعد** نشر النسخة الجديدة |

**الترتيب إلزامي:** (1) نفّذ الملف الأول → (2) انشر الويب + APK v30 →
(3) نفّذ الملف الثاني. عكس الترتيب يعني أن التطبيق القديم يفقد تسجيل الدخول
والتسجيل الجديد (المحتوى والإشعارات لا تتأثر إطلاقاً).

بعد التنفيذ تحقّق بمفتاح anon من خارج التطبيق:
```
GET /rest/v1/registrations?select=*          → 401 permission denied
GET /rest/v1/feedback_messages?select=*      → 401 permission denied
```
ومن SQL Editor:
```sql
SELECT has_table_privilege('anon','public.registrations','SELECT');     -- false
SELECT has_table_privilege('anon','public.feedback_messages','SELECT'); -- false
SELECT * FROM public.list_registrations();                              -- 42501 بلا توكين
```

**ما لم يُلمس:** `notifications` وسياساتها، قناة realtime الخاصة بها،
`push_tokens`، `web_push_subscriptions`، Edge Functions، وStorage.
الشيء الوحيد الذي يتغيّر سلوكياً: القائمة الحيّة للتسجيلات في شاشة المطوّر
لم تعد تستقبل INSERT فورياً عبر realtime (RLS تمنعها)، لكن الشاشة تُحدِّث
القائمة عند فتحها، وهي شاشة مطوّر فقط.

### 3.2 فوري — الأنبوب (P0): مفتاح التوقيع مسرَّب
> 📘 خطة تنفيذ جاهزة بالأوامر والترتيب: **`docs/ROTATION-RUNBOOK.md`** (مكتوبة لنافذة «3 طلاب» الحالية).

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

### 3.3 ✅ **مُنفَّذ** — تنظيف تاريخ Git (2026-10-22)

نُفِّذ فعلياً على المستودع المحلي ثم بدُفع قسري إلى GitHub:

```powershell
git bundle create "$env:USERPROFILE\almohanndes-history-backup-20261022.bundle" --all   # نسخة احتياطية
git filter-repo --invert-paths --path-glob '*keystore*' --force
git reflog expire --expire=now --all; git gc --prune=now
git push --force origin main
```

| الفحص | النتيجة |
|---|---|
| شجرة `HEAD` قبل/بعد | متطابقة — صفر تغيير في الملفات |
| الملفات / الكوميتات | 246 / 753 قبل = 246 / 753 بعد |
| أي كائن فيه `keystore` في التاريخ | **0** |
| `e890b82` (الذي حمل `keystore.properties.old`) | `fatal: Not a valid object name` |
| `git ls-remote origin` | `main = 1cd55f6` فقط |

حُذفت من كل التاريخ: `android/almohanndes.keystore` · `android/keystore.properties` ·
`android/keystore.properties.old` · `احتفظ-بهذا-مجلد/*` · `توقيع المهندس/keystore.properties`.

> الكوميتات القديمة قد تبقى «معلّقة» على خوادم GitHub حتى جامع القمامة، لكن المستودع خاص
> والمفتاح ميت. للضمان المطلق: أعد إنشاء المستودع وادفع `main` الحالي.
> أي نسخة على جهاز آخر تحتاج استنساخاً جديداً (لا `git pull`).



### 3.4 فوري — تدوير الأسرار
- `dev_password`: شاشة الإعدادات → تغيير الرمز (أو SQL: `change_dev_code`).
- `BOT_TOKEN`: BotFather → `/revoke`.
- `SUPABASE_SERVICE_KEY`: لا تضعها في التطبيق إطلاقاً؛ فقط في Railway.
- أي كلمة سر مستخدم كانت مكتوبة في التاريخ: أعد تعيينها.

### 3.5 ✅ **مُنفّذ ومقيس** — إغلاق الجداول الحسّاسة (2026-10-23)
```
المسار: supabase/migrations/20261023120000_lock_secret_tables.sql
```
انسخ كامل محتواه والصقه في Supabase → SQL Editor → Run. آمن للتكرار.

**ماذا يُغلق (قياس فعلي قبل التنفيذ):**

| الجدول | الحالة الآن | بعد التنفيذ |
|---|---|---|
| `push_tokens` | قراءة كل رموز FCM + القسم + `is_developer`، وزرع توكنات، وحذف أي توكن (تعطيل إشعارات أي جهاز) | القراءة `401` · الكتابة تبقى تعمل (تسجيل/إلغاء الأجهزة) |
| `user_passwords` | قراءة `password_hash` (SHA-256) لحظة وجود أول صف ⇒ كسر كلمات السر بلا اتصال | `401` — والمنطق كله عبر RPC (`password_status` / `verify_password` / `set_password`) |
| `web_push_subscriptions` | قراءة `endpoint + p256dh + auth` لكل مشتركي الويب | `401` — الكتابة تبقى |

**النتيجة المقيسة بعد التنفيذ (بمفتاح anon، لا تخمين):**

| الفحص | قبل | بعد |
|---|---|---|
| `GET /rest/v1/push_tokens?select=*&limit=1` | `200` | ✅ `401` + `42501` |
| `GET /rest/v1/user_passwords?select=*&limit=1` | `200` | ✅ `401` + `42501` |
| `GET /rest/v1/web_push_subscriptions?select=*&limit=1` | `200` | ✅ `401` + `42501` |
| `POST /rest/v1/push_tokens` (تسجيل جهاز) | `201` | ✅ `409` ازدواج فقط (أي الصلاحية قائمة) |
| `DELETE/PATCH /rest/v1/push_tokens?token=eq.<x>` | `204`/`204` | ✅ `401` — لم يعد أحد يعطّل إشعارات جهاز غيره |
| `POST /rest/v1/rpc/password_status` | `200` | ✅ `200` (`{"must_change":false,"has_password":false}`) |
| `GET /rest/v1/notifications` | `200` | ✅ `200` (بقرارك: لا تُمس) |

> نتيجة جانبية مقصودة: PostgREST يطلب صلاحية `SELECT` لأي `DELETE`/`UPDATE` **بفلتر**،
> فتعطّل مسار «إلغاء تسجيل الجهاز» القديم. عُوِّض بدالتين `SECURITY DEFINER`
> في 3.6، وحُدِّثت الشيفرة لتستخدمهما أولاً (`src/lib/push.ts`، `src/lib/deletedGuard.ts`).
> ⚠️ لا يسري أثر تحديث الشيفرة إلا في **البناء القادم (v32)**؛ في v31 يبقى الحذف
> صامتاً (تسجيل الأجهزة والإرسال يعملان، لكن جهاز محظور قد يستمر في الاستقبال
> حتى أول تشغيل لـv32 أو حتى إعادة تسجيله).
> ✅ **v32 بُني ووُقّع** (`Almohanndes-release-v32-signed.apk`، SHA-256 `F061FC8E…9D48`)
> — المتبقي: توزيعه على الأجهزة.


وخدمة الإرسال `push-notify` تستخدم `service_role`، والتطبيق لا يقرأ هذه الجداول
(الشيفرة تسقط بأمان إلى `mode:'none'` إن مُنعت القراءة).

**بعد التنفيذ — تحقّق (5 دقائق):**
1. `GET /rest/v1/push_tokens?select=*&limit=1` بمفتاح anon → يجب `401`/`42501`.
2. افتح التطبيق على جهاز، ثم من SQL Editor: `select public.push_diag();` → يجب أن يظهر التوكن و`alerts_enabled=true`.
3. أضف محاضرة تجريبية من حساب المطوّر → يجب أن يصل إشعار للجهاز.
4. سجّل دخول طالب بكلمة سر → يجب أن ينجح (RPC يعمل).
5. فشل أي بند؟ نفّذ قسم **«التراجع»** في نهاية الملف (5 أسطر) وأبلغني.

> ملاحظة مقصودة: جدول `notifications` **يظل عام القراءة** احتراماً لقرارك
> «لا تلمس الإشعارات» — ويُغلق فقط إن طلبت لاحقاً.

### 3.6 ⏳ نُفِّذ — وبقي إعادة تشغيل ملف المصالحة (قياس 2026-10-23)

```
1) supabase/migrations/20261023140000_reconcile_schema.sql    ← شغّله أولاً
2) supabase/migrations/20261023150000_password_bcrypt.sql     ← ثم هذا
```

**① المصالحة — لماذا:** الحالة الحيّة تختلف عن الملفات. `app_password_hash()`
موجودة في القاعدة وليست في أي هجرة، وكذلك `user_passwords` و`auth_throttle`.
أي إعادة بناء من الصفر ⇒ كل تسجيل دخول يفشل بصمت.

| ماذا يفعل | التفصيل |
|---|---|
| `pgcrypto` | يضمن الامتداد (تجزئة bcrypt) |
| `user_passwords` / `auth_throttle` | `CREATE TABLE IF NOT EXISTS` ⇒ لا يمسّ البيانات الحيّة |
| `app_password_hash()` | **تُنشأ فقط إن كانت غائبة**؛ وإن وُجدت لا تُلمس، بل يُقارَن ناتجها بـ`SHA-256(phone::password)` ويُطلق `RAISE WARNING` عند الاختلاف |
| RPC جديد: `unregister_push_token(p_token)` | حذف صف توكن واحد بمفتاحه بدل `DELETE` بفلتر (المحجوب) |
| RPC جديد: `unregister_web_push(p_endpoint)` | نفس الفكرة لاشتراكات الويب |
| تنظيف | يحذف صف الاختبار `probe-lock-2026` الذي زرعته أثناء القياس |

**② bcrypt — لماذا:** المخزَّن الآن `SHA-256(phone::password)` بتجزئة سريعة
بلا كلفة ⇒ من يقرأ صفاً واحداً يجرّب ملايين الكلمات على GPU.

| القرار | الأثر |
|---|---|
| الهاش الجديد `crypt(password, gen_salt('bf',10))` | يبدأ بـ`$2a$10$` — كلفة تُبطئ التخمين آلاف المرات |
| `password_hash_check()` تقرأ الصيغتين | **لا ينكسر دخول أي طالب** والهاش القديم يبقى مقبولاً |
| ترقية تلقائية عند أول دخول ناجح | `verify_password` و`progress_session_open` تحوّلان الهاش القديم إلى bcrypt في مكانه |
| `set_password` يكتب bcrypt دائماً | كل كلمة جديدة محمية من الآن |
| حدود المحاولات | نفس `auth_throttle` بلا أي تغيير |
| اختبار ذاتي داخل الملف | يتحقق من صحة bcrypt، ورفض الكلمة الخطأ، وقبول الهاش القديم — ويفشل بـ`EXCEPTION` إن اختل شيء |

**قياس ما بعد التنفيذ (مفتاح anon، `scripts/check-security-migrations.mjs` → 11/12):**

| الفحص | النتيجة |
|---|---|
| `GET push_tokens` / `user_passwords` / `web_push_subscriptions` | ✅ `401` + `42501` (ما زالت مغلقة) |
| `POST rpc/unregister_push_token {"p_token":"…"}` | ✅ `200 {"ok":true,"removed":0}` — الثغرة الوظيفية أُغلقت |
| `POST rpc/unregister_web_push` | ✅ `200 {"ok":true,"removed":0}` |
| `POST rpc/unregister_push_token {"p_token":"   "}` | ✅ `200 {"ok":false,"reason":"bad_input"}` |
| `POST rpc/password_status {"p_phone":"…"}` | ✅ `200 {"must_change":false,"has_password":false}` |
| `POST rpc/verify_password` (بيانات خاطئة) | ✅ `200 false` |
| `app_password_hash('a','b')` من anon | ❌ كان `200` ويعيد `78f0be89…` = `SHA-256("a::b")` بالضبط ⇒ **الصيغة مؤكَّدة، لكن الدالة كانت مناحة للعميل** |
| `app_password_hash('779809243','test1234')` من anon — **إعادة قياس 2026-10-23 04:05** | ❌ ما زال `200` ويعيد `ce3c26c7…` ⇒ **الملف ① لم يُعَد تشغيله بعد**، والسحب المضافة في `db5850c` غير مطبَّق على القاعدة الحيّة |
| `password_hash_make` / `password_hash_check` من anon | ✅ `404 PGRST202` (غير مكشوفة للدور) |

**الثغرة التي كشفها القياس:** الـ`REVOKE` على `app_password_hash` كان **داخل** فرع
«أنشئها إن كانت غائبة»، والدالة موجودة في الإنتاج ⇒ لم يُسحب منها شيء. أُضيف إلى
ملف المصالحة بلوك `DO` يسحب `EXECUTE` عن `PUBLIC`/`anon`/`authenticated` من كل
نسخة موجودة **دائماً** (ديناميكياً بـ`pg_get_function_identity_arguments`، فلا تفشل
إن اختلفت أنواع الوسائط). لا يكسر شيئاً: كل دوال كلمة المرور `SECURITY DEFINER`
تعمل بصلاحية المالك. **⇒ أعد تشغيل الملف ① (idempotent) لتطبيق السحب.**

**أثر جانبي وظيفي مقيس (2026-10-23) — دخول المتصفّح يفشل:** نسخة الويب المنشورة على
`al-mohandes-app-2026.vercel.app` **أقدم من الإغلاق**: الحزمة المخدومة
`assets/index-7ZDyTk2W.js` (575,076 حرفاً) لا تحوي `registration_by_phone` ولا
`register_student`، فشاشة الدخول فيها ما زالت تقرأ `registrations` مباشرةً ⇒
`401 42501 permission denied` ⇒ الرسالة العامة «تعذّر التحقق. تأكد من اتصال الإنترنت»
(الشبكة سليمة؛ الخطأ صلاحية لا اتصال).

| الفحص (مفتاح anon، حي) | القياس |
|---|---|
| `rpc/registration_by_phone {p_phone}` | ✅ `200` ويعيد صف الطالب |
| `rest/registrations?phone=eq.…` | ✅ `401` + `42501` — الإغلاق يعمل كما صُمِّم |
| الحزمة المحلية `assets/index-Dm6GTvo_.js` | ✅ تحوي `registration_by_phone` + `register_student` + `unregister_push_token` |
| الحزمة المنشورة `assets/index-7ZDyTk2W.js` | ❌ لا تحوي أياً منها ⇒ **نشر قديم** |

**محدَّث (2026-10-23، بعد إعادة النشر):** الحزمة المخدومة الآن
`assets/index-Dm6GTvo_.js` (576,153 حرفاً) = الحزمة المحلية بالضبط، وتحوي
`registration_by_phone` + `register_student` + `unregister_push_token`.
`node scripts/diagnose-login.mjs` ⇒ `served == local`، و`rpc/registration_by_phone` ⇒ `200`،
و`rest/registrations` ⇒ `401 42501` (الإغلاق سليم). رأس `Content-Security-Policy` موجود.

**الإصلاح:** أعد نشر `dist` (أو ثبّت APK v32 الذي يحمل الحزمة الجديدة). إعادة النشر
لا تُعيد أي ثغرة — الحزمة الجديدة تستخدم RPC بدل القراءة المباشرة. الـ`sw.js` يعمل
network-first لطلبات التنقّل، فتكفي إعادة تحميل واحدة بعد النشر. التشخيص المتكرِّر
(قراءة فقط): `node scripts/diagnose-login.mjs [phone] [webUrl]`.

**الإصلاح الدائم (لمنع تكرار «النشر القديم»)**: النشر كان يدوياً برفع حزمة مبنية، وهذا
سبب بقاء الحزمة القديمة. صار المشروع جاهزاً لنشر Git: `vercel.json` يثبّت
`framework=vite` + `npm run build` + `dist`، و`vite.config.ts` **يُفشل البناء** إن غاب
`VITE_SUPABASE_URL` أو `VITE_SUPABASE_ANON_KEY` (بدل إنتاج bundle يشير إلى `undefined`).
الخطوات مرة واحدة في `DEPLOY-WEB.md` (ربط المشروع الموجود `al-mohandes-app-2026`
بالمستودع حتى يبقى النطاق نفسه). بعدها كل `push` إلى `main` ينشر تلقائياً.

**التحقّق الكامل (للقراءة فقط، دور postgres):** `supabase/checks/verify_password_migrations.sql`
— أربعة جداول: توقيعات الدوال وصلاحياتها · جاهزية bcrypt وعدد الهاشات القديمة/الجديدة
· اختبار `password_hash_check` على صيغة SHA-256 القديمة · صلاحيات `anon` على الجداول.


> ⚠️ **لا تراجع لملف bcrypt:** إعادة الدوال لنسختها القديمة تُفشل دخول من رُقّي
> هاشه. المسار الآمن: الإبقاء على `password_hash_check` (تقرأ الصيغتين).
> أما ملف المصالحة فالتراجع عنه = حذف الدالتين فقط (بلا أثر على البيانات).

---

## 4) حارس تلقائي

```powershell
node scripts/check-secrets.mjs    # يفشل إذا وُجد سرّ في ملفات Git المتتبَّعة
```
و GitHub Actions يشغّله مع `npm run typecheck` عند كل دفع
(`.github/workflows/security.yml`).

> ملاحظة: الفحص يمرّ لأن ملفات keystore خرجت من **الفهرس**، وتاريخ المستودع
> **نُظِّف فعلياً** في 3.3 (صفر كائنات keystore). لكن الفحص أداة محلية: يُنصح
> بتشغيل **GitHub Secret Scanning + Push protection** من إعدادات المستودع
> (Settings → Code security) كطبقة تحقّق مستقلة عن أي سكربت.

---

## 5) ثغرات متبقية معروفة (مقبولة حالياً — تحتاج قراراً لاحقاً)

| # | الوصف | الأثر | العلاج المقترح |
|---|---|---|---|
| 1 | المفتاح العام (`anon`) مضمَّن في التطبيق | قراءة كل المحتوى | طبيعي في تصميم Supabase بلا تسجيل دخول |
| 2 | ~~رقم هاتف الطلاب مقروء للجميع في `registrations`~~ → **أُغلق** بنسبة كبيرة في 3.1.3 | — | المتبقي: `registration_by_phone` يخبرك باسم صاحب الرقم إن كان مسجلاً — «أداة تحقّق» تحتاج معرفة الرقم مسبقاً. يمكن تخفيفها لاحقاً بإرجاع `exists` فقط للدخول + طلب الاسم من جلسة المستخدم |
| 3 | ~~كلمة المرور = SHA-256(phone::password) بلا bcrypt~~ → **نُفِّذ** في 3.6 (`20261023150000_password_bcrypt.sql`) — التأكيد النهائي بـ`supabase/checks/verify_password_migrations.sql` | — | أرسل ناتج سكربت التحقّق؛ الهاش القديم يُرقّى تلقائياً في أول دخول ناجح |
| 4 | لا يوجد Play Integrity / SSL pinning | تشغيل على جهاز معدّل | Play Integrity + شهادة مثبَّتة |
| 5 | الحزمة الويب مقلَّصة (esbuild) فقط | قراءة الكود | `javascript-obfuscator` عند البناء (يحتاج اختبار) |
| 6 | ~~`push_tokens` مفتوح للكتابة **والقراءة**~~ → ✅ **أُغلق** في 3.5: `GET` → `401`، و`DELETE`/`UPDATE` بفلتر → `401` (لا يعطّل أحد إشعارات غيره) | — | لا شيء متبقٍ (الكتابة للتسجيل فقط) |
| 7 | حساب في حالة «يجب تغيير كلمة المرور» يقبل تعيين كلمة مرور جديدة بلا كلمة حالية | اختطاف خلال نافذة قصيرة بعد إعادة تعيين المطوّر | يُغلق نهائياً بإصدار «جلسة تغيير» قصيرة العمر بعد `verify_password` |
| 8 | ~~`user_passwords.password_hash` مقروء بالمفتاح العام~~ → ✅ **أُغلق** في 3.5 (`GET` → `401`) · التجزئة السريعة تُصلَب في 3.6 (bcrypt) | — | نفّذ 3.6 لتحويل الهاش |
| 9 | ~~`user_passwords` / `auth_throttle` غير معرَّفتين في الملفات~~ → ✅ **حُلّت** بهجرة المصالحة 3.6 (`CREATE TABLE IF NOT EXISTS`) | — | نفّذ 3.6 |
| 10 | ~~`app_password_hash()` في القاعدة وغير موجودة في أي هجرة~~ → ✅ **حُلّت** بهجرة المصالحة 3.6 (تُنشأ إن غابت، وتُقارن إن وُجدت) · القياس كشف أنها كانت قابلة للتنفيذ من anon ⇒ أُضيف سحب `EXECUTE` دائم | — | أعد تشغيل الملف ① |
| 11 | `DELETE`/`UPDATE` بفلتر على الجداول الحسّاسة صار محجوباً ⇒ إلغاء تسجيل جهاز يعتمد على RPC جديد | ~~في APK v31 يبقى تعطيل جهاز محظور صامتاً~~ → ✅ **v32 مبني وموقّع** ومساره الجديد مضمَّن داخل الحزمة (مقيس) | وزّع `Almohanndes-release-v32-signed.apk` (`F061FC8E…9D48`) |

---

## 6) ما لا يفعله أي كود

لا يوجد سطر برمجي يستطيع إصلاح مفتاح توقيع مسرَّب، ولا منع نسخ موقع يعمل بمفتاح
عام. الحماية الحقيقية = **مفتاح جديد + تنظيف التاريخ + كتابة مشروطة من الخادم**،
وهذا ما تم هنا باستثناء ما يحتاج قرارك في القسم 3.
---

## 7) قياس 2026-10-23 — «تعذّر التسجيل» و«المطوّر لا يعتمد/يحذف المسجّل»

كل ما يلي **مقيس فعلياً** بمفتاح `anon` (سكربتات `scripts/diagnose-*.mjs`)، لا مستنتجاً من قراءة الكود.

### أ) المطوّر: صلاحية جدول ناقصة (خطأ في القاعدة)

| العملية | قبل الإصلاح |
| --- | --- |
| `PATCH /rest/v1/registrations` (اعتماد) | ❌ `401 42501 permission denied for table registrations` |
| `DELETE /rest/v1/registrations` (حذف) | ❌ `401 42501` |
| `PATCH` / `DELETE /rest/v1/feedback_messages` | ❌ `401 42501` |
| `INSERT` / `UPDATE /rest/v1/app_settings` | ❌ `401 42501` |
| `lectures` · `assignments` · `exams` · `reference_materials` · `study_tasks` · `notifications` | ✅ لا تغيير |

السبب: `registrations` و`feedback_messages` و`app_settings` أُنشئت بملفات هجرة، فلم تصلها صلاحيات
Supabase الافتراضية للجداول الجديدة. سياسات RLS للمطوّر كانت موجودة، لكن **RLS لا تُفحص أصلاً
إذا لم تكن صلاحية الجدول (GRANT) ممنوحة** ⇒ يرد PostgREST قبل الوصول إلى السياسة.
الإصلاح: `supabase/migrations/20261023160000_restore_dev_write_grants.sql`
(`GRANT UPDATE, DELETE` + تأكيد بقاء `SELECT` مسحوباً + تحقق ذاتي يفشل إن نقص شيء).

> الواجهة كانت تُخفي هذا الخطأ (`catch {}`)، فيبدو الزر كأنه «لا يفعل شيئاً». صار الآن يُظهر
> إشعاراً بلون الخطأ ورسالة محدّدة (`describeWriteError` في `src/lib/api.ts`).

### ب) التسجيل: الخادم سليم — الفشل من العميل

المقيس على `register_student` + `set_password` + `verify_password` + `progress_session_open`
برقم جديد كلياً: **كلها `200 ok`** (كلمة المرور تُهشَّر في Postgres، والجلسة تُفتح).
أي أن الخطأ لن يظهر إلا من عميل قديم أو من حالة حساب قائم:

| السبب | ما يحدث بالضبط | ما يراه المستخدم |
| --- | --- | --- |
| حزمة قديمة/APK v31 (مبنية قبل هجرة القراءة) | `INSERT ... RETURNING` يحتاج `SELECT` المسحوب ⇒ `401 42501`، **ولا يُكتب أي صف** | «حدث خطأ أثناء التسجيل. حاول مرة أخرى.» (نص عام) |
| رقم له كلمة مرور مسبقاً (طالب عائد) | `register_student` ينجح ← `set_password` يرد `{ok:false, reason:"current_required"}` ← الصف يبقى معلّقاً بلا كلمة مرور | نفس النص العام، ويظهر الطالب في قائمة «المسجلون» بلا فائدة |

الإصلاح في `src/lib/api.ts` + الشاشات:

1. `addRegistration` تفحص `password_status` **قبل** الإدراج ⇒ لا صفّ وهمي للطالب العائد.
2. `describeRegistrationError` تميّز: `42501` ⇒ «هذه النسخة قديمة، حدّث الصفحة/التطبيق» ·
   `current_required`/`23505` ⇒ «الرقم مسجّل مسبقاً بكلمة مرور، سجّل الدخول».
3. نصوص التحقق لم تعد تُبتلع: التسجيل والإعدادات والاعتماد/الحذف تُظهر السبب الحقيقي.

### ج) أدوات القياس المضافة

```
node scripts/diagnose-register.mjs        # وجود دوال التسجيل/القراءة
node scripts/diagnose-signup.mjs          # تسجيل كامل برقم وهمي 700000000
node scripts/diagnose-legacy-insert.mjs   # إثبات فشل العميل القديم (42501) + بصمة الحزمة المخدومة
node scripts/diagnose-grants.mjs          # مصفوفة صلاحيات INSERT/UPDATE/DELETE لكل جدول
```

