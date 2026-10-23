# حماية الكود من الهندسة العكسية — الحالة المُنفَّذة والقياسات

> آخر تحديث: 2026-10-23 · كل رقم في هذا الملف **مقيس فعلياً** على هذا المشروع،
> لا مأخوذ من وثائق عامة.

## 0) نموذج التهديد (ما نحاول منعه فعلاً)

| التهديد | مثال واقعي | الطبقة التي تمنعه |
|---|---|---|
| قراءة منطق التطبيق ونسخه | فكّ APK → `assets/public/assets/*.js` → قراءة/بيع الكود | **تشويش Vite** (طبقة 1) |
| إعادة تسمية الحزمة وبيعها كتطبيق آخر | apktool + تعديل + توقيع بمفتاح جديد | **بصمة التوقيع** (طبقة 3) |
| تعديل الحزمة لفتح ميزات مدفوعة | patch ملف JS داخل APK | بصمة التوقيع + (لاحقاً) Play Integrity |
| تشغيل نسخة معدّلة على جهاز مروّت | hook على التطبيق | Play Integrity (طبقة 4، خطة) |
| سحب المفتاح/الأسرار من الحزمة | grep للحزمة على `secret` | تشويش النصوص (طبقة 1) — **لا ينطبق على `anon key`** |

## 1) تشويش JavaScript عبر Vite ✅ مُنفَّذ ومُتحقَّق

**الملفات:**
- `build/vite-plugin-obfuscator.ts` — المكوّن نفسه (آخر خطوة في `generateBundle`).
- `vite.config.ts` — يفعّله في الإنتاج فقط.
- `scripts/build-web.mjs` + `npm run build:nobf` — بناء بديل بلا تشويش (تشخيص).
- `scripts/check-chunk-bindings.mjs` — فحص آلي لربط القطع بعد التشويش.

**ما يفعله:** بعد `minify` يجمع **100%** من النصوص الحرفية في مخزن مشفّر
(base64 للقطع الكبيرة، rc4 للصغيرة)، يبدّل الفهارس ويدوّرها، يعطي أسماء
مُعرّفات سداسية، ويضيف `selfDefending` (تنسيق الكود يكسره) + `disableConsoleOutput`.

**إعدادات مقصودة ومعطّلة (مهم):**
| الخيار | الحالة | السبب |
|---|---|---|
| `renameGlobals` | **false** | أسماء التصدير بين القطع ESM تُحلّ بالاسم وقت التشغيل ⇒ true يكسر التطبيق |
| `renameProperties` | **false** | React/DOM/Capacitor تعتمد على أسماء خصائص نصية |
| `transformObjectKeys` | **false** | يكسر خصائص تُقرأ من DOM |
| `controlFlowFlattening` | **false** (اختياري: `OBFUSCATE_CFF=1`) | أعلى تحويل خطورة على الكود غير المتوقّع |
| `debugProtection` | **false** | حلقات `debugger` لا نهائية تُجمّد WebView وتُعيق التشخيص |
| `selfDefending` | **false** (`OBFUSCATE_SELFDEF=1`) | يستخدم `Function(...)` = eval، و`vercel.json` يفرض `script-src 'self'` بلا `'unsafe-eval'` ⇒ عُطِّل افتراضياً تفادياً لسلوك غير محدد على الويب |
| `stringArrayThreshold` | **1** | 0.8 كان يترك 20% مكشوفة (قِيس: ظهر عنوان المشروع مرة في إصدار) |

**القياس الفعلي (هذا الجهاز):**

| المقياس | قبل | بعد |
|---|---|---|
| زمن `vite build` | ~4 ث | **9.4 ث** |
| حجم حزمة الدخول | 585 KB | 1275 KB (×2.18) |
| إجمالي JS | 601 KB | 1373 KB (×2.28) |
| حجم APK | 6.94 MB | **7.20 MB** (الضغط في APK يقلّص الفرق) |
| `supabase.co` داخل APK | موجود | **0 ظهور** |
| `register_push_token` / `push_webhook_secret` / `delete_my_account` | موجود | **0 ظهور** |
| نصوص عربية (رسائل/أخطاء) | مقروءة | **0 ظهور** |

**ما يبقى مكشوفاً — بصراحة:**
1. `is_developer` (4) و`alerts_enabled` (10): ليست نصوصاً بل **مفاتيح كائنات
   JSON** تُرسل في كل طلب شبكة؛ أي أحد يفتح Network يراها. تشويشها تجميلي.
2. أسماء ملفات القطع (`postponementSkip-*.js`) — مسارات تحميل لا يمكن تشويشها.
3. أسماء أصناف Tailwind في CSS (بنية الواجهة تُخمَّن من CSS).
4. `VITE_SUPABASE_URL` / `anon key` — موجودة كبيانات مشفّرة داخل المخزن، لكنها
   تُرسل في كل طلب HTTP أصلاً ⇒ حمايتها الحقيقية = RLS (راجع `SECURITY.md`).
5. **ملاحظة CSP:** الحزمة تحتوي `Function('return this')` واحداً من اعتمادية
   (كان موجوداً قبل التشويش)، وهو محاط بـ`try/catch` مع بديل `window` ⇒ آمن تحت
   `script-src 'self'`، لكنه قد يولّد تنبيه CSP في الكونسول. لا يكسر التطبيق.

**التحقق بعد أي بناء:**
```powershell
npm run build
node scripts/check-chunk-bindings.mjs   # ✓ ربط القطع سليم
# فحص عدم تسرّب نصوص:
Get-ChildItem dist/assets/*.js | Select-String 'supabase\.co|register_push_token'
```

**التراجع السريع (لو كسر التشويش ميزة):**
```powershell
npm run build:nobf     # نفس البناء بلا تشويش
```
ثم أبلغ بالقطع المسؤولة — نبني تشويشاً أضيق بدل تعطيل الطبقة كلها.

## 2) R8 / ProGuard ✅ مُنفَّذ ومُتحقَّق

**`android/app/proguard-rules.pro`** أُعيد تنظيمه وأُضيفت الثغرات الوظيفية:
- **Firebase/FCM**: إبقاء `FirebaseMessagingService` و`onNewToken`/`onMessageReceived`
  (كانت تعمل بفضل قواعد AAR المضمّنة فقط — الآن صريحة، فلا تنكسر بصمت).
- `-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod` (الانعكاس).
- إبقاء `@PluginMethod` و`@JavascriptInterface` بالاسم.
- `-dontwarn` للمراجع الاختيارية (kotlin, jspecify, conscrypt…) لمنع إفشال البناء.
- `-repackageclasses ''` + `-allowaccessmodification` + `-overloadaggressively`.

**`android/app/build.gradle`** — توليد قواعد `-keep` تلقائياً من
`assets/capacitor.plugins.json`:
Capacitor ينشئ كل بلجن بـ`Class.forName(classpath)` من ذلك الملف؛ لو أعاد R8
تسمية صنف لانهار التطبيق عند الإقلاع (`ClassNotFoundException`) بلا أي خطأ
بناء. الآن القائمة والقواعد من مصدر واحد ⇒ لا يمكن أن يحدث عدم تطابق.
الملف المُولَّد: `android/app/build/generated/r8-rules/capacitor-plugins-keep.pro`.

**قياس:** `:app:minifyReleaseWithR8` نجح — `BUILD SUCCESSFUL`, و`mapping.txt`
يُظهر أصنافاً بأسماء بلا معنى (`kg0`, `rx`) بعد ضمّ كل الحزم إلى الجذر.

**ملاحظة موثّقة (تجربة فاشلة):** جرّبنا `-obfuscationdictionary` (قاموس أسماء
مشابهة `l/I/1`) — R8 8.13 **تجاهله بصمت** (صفر أسماء من القاموس في
`mapping.txt`، بلا خطأ). حُذف الإعداد بدل إبقائه وهمياً.

## 3) بصمة التوقيع (مُنفَّذة قبل هذه الجلسة) ✅

`app/build.gradle` يحسب SHA-256 لشهادة التوقيع ويحقنها في
`BuildConfig.APP_SIGNER_SHA256`، و`MainActivity.onCreate` يرفض العمل إذا:
- البصمة مختلفة (APK مُعاد توقيعه) → `finish()` + `Process.killProcess()`.
- البناء `debuggable` أو هناك مُصحِّح (debugger) متصل.
هذه الطبقة **تعمل بلا إنترنت** وتغلق أهم سيناريو (بيع التطبيق باسم آخر).

## 4) Play Integrity — خطة تنفيذ مرحلية

راجع `docs/PLAY-INTEGRITY-PLAN.md` (المتطلبات، المعمارية، المراحل، الكود الجاهز).

## 5) قائمة فحص قبل كل إصدار

1. `npm run typecheck && npm run lint` — نظيف.
2. `npm run build` — يظهر `[obfuscator] N/N قطعة` (لا `skipped`).
3. `node scripts/check-chunk-bindings.mjs` — ✓.
4. `npm run sync:android` ثم `gradlew assembleRelease` — `BUILD SUCCESSFUL`.
5. تجربة دخول + إشعار اختباري على جهاز حقيقي (التشويش يغيّر كل إصدار بذرةً).
6. رفع `versionCode`.
