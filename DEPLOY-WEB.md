# نشر الويب على Vercel من GitHub

الهدف: أن يبني Vercel الموقع **من المستودع** عند كل `push` إلى `main`، بدل رفع حزمة مبنية يدوياً.
السبب: النشر الحالي قديم (`assets/index-7ZDyTk2W.js`) ولا يحتوي إصلاحي الدخول
(`registration_by_phone` / `register_student`)، فيفشل تسجيل الدخول من المتصفح برسالة
«تعذّر التحقق. تأكد من اتصال الإنترنت». القياس في `SECURITY.md`.

> **مهم:** اربط **المشروع الموجود** `al-mohandes-app-2026` (Settings → Git) ولا تُنشئ مشروعاً
> جديداً — حتى يبقى النطاق `al-mohandes-app-2026.vercel.app` نفسه الذي يستخدمه البوت والطلاب.

## الخطوات (مرة واحدة)

1. **اربط المستودع:** لوحة Vercel → المشروع `al-mohandes-app-2026` → `Settings` → `Git` →
   `Connect Git Repository` → GitHub → `abualbakri0/al-mohandes` → Production Branch: `main`.
   (إن طلب Vercel تثبيت تطبيق GitHub على الحساب، اسمح لهذا المستودع فقط.)
2. **إعدادات البناء:** `Settings` → `Build & Development Settings`
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Root Directory: `./` · Install Command: اتركها افتراضية
   (نفس القيم مكتوبة في `vercel.json` فلا تحتاج تعديلها هناك.)
3. **متغيّرات البيئة:** `Settings` → `Environment Variables` — أضف لكل من Production و Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   القيم موجودة في ملف `.env` على جهازك (سطر لكل متغيّر). `VITE_IOS_URL` اختياري.
   هذه قيم عامة تُحزَّم داخل الـbundle أصلاً، لكن لا تكتبها في Git.
4. **أول نشر:** `Deployments` → آخر نشر → `⋯` → `Redeploy` (أو ادفع أي commit إلى `main`).

من هنا فصاعداً: كل `git push origin main` = نشر تلقائي. لا حاجة لـ`vercel login` ولا لرفع zip.

## حماية مضافة في هذا الإصدار

`vite.config.ts` يتحقّق الآن من وجود `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` **قبل**
البناء ويُفشل البناء برسالة واضحة إن غابا. بلا هذا الحرس كان بناء سحابي بلا متغيّرات
سيُنتج bundle يشير إلى `undefined` فيفشل كل شيء بصمت.

## التحقق بعد النشر

```bash
node scripts/diagnose-login.mjs
```

المتوقّع: `served == local` (اسم الـbundle المنشور = اسم الحزمة المحلية) و`YES/YES` لدخول
تجريبي. `sw.js` يعمل network-first، فتكفي إعادة تحميل واحدة (أو `Ctrl+Shift+R`).

## تحذير لا يُخالَف

لا تُعِد منح `SELECT` على `registrations` للدور `anon` «لإصلاح» الحزمة القديمة — الحزمة
القديمة ترسل رقم الهاتف كفلتر من العميل، فأي منح يعيد كشف أسماء وأرقام كل الطلاب
(`401 42501` الحالي هو السلوك الصحيح). الإصلاح هو نشر الحزمة الجديدة فقط.
