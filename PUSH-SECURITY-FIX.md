# إصلاح ثغرتي الإشعارات (N1 + N2) — دليل التنفيذ

> الحالة: **الكود جاهز ومُتحقَّق منه** (typecheck + lint + build ناجحة، وفحص صياغة لدالة الحافة).
> المتبقّي: تنفيذ خطوات القاعدة والنشر أدناه — تحتاج صلاحية لوحة Supabase (لا تُنفَّذ من المستودع).

## 1) ما كان مكسوراً — بقياس مباشر (2026-10-23)

| # | القياس | النتيجة |
|---|---|---|
| N1 | `POST /functions/v1/push-notify` بجسم `{}` وبمفتاح anon فقط | **200** `{"skipped":true}` ⇒ لا فحص سرّ إطلاقاً. أي شخص يملك المفتاح العام (مضمَّن في التطبيق) يستطيع `{"title":"…","body":"…"}` فيُرسل إشعاراً **لكل الأجهزة** |
| N2 | `POST /rest/v1/rpc/register_push_token {"p_is_developer":true}` من جهاز مجهول | **204** ⇒ الجهاز صار «مطوّراً» ويستقبل إشعار كل تسجيل جديد: **اسم الطالب + رقم هاتفه** |

السبب: `WEBHOOK_SECRET` غير مضبوط ⇒ `if (webhookSecret)` كان يتخطّى الفحص (fail-open)، و`is_developer` كان يُقبل من العميل في ثلاثة مسارات (دالة الحافة / RPC / كتابة PostgREST مباشرة).

## 2) ما تغيّر

| ملف | التغيير |
|---|---|
| `supabase/migrations/20261024090000_push_notifications_hardening.sql` | (أ) `public.push_webhook_secret()` تقرأ السرّ من Vault — `service_role` فقط. (ب) **تدوير السرّ المسرَّب نفسه داخل نفس الملف** (لا يُطبع في السجلات، ولا يمسّ سرّاً سليماً عند إعادة التنفيذ). (ج) حارس `push_guard_dev_flag` (BEFORE INSERT OR UPDATE) على `push_tokens` و`web_push_subscriptions` يُسقط `is_developer` إن لم يكن `x-dev-token` صالحاً. (د) تصفير أي صفة مطوّر مُدّعاة. (هـ) حذف صفوف `PROBE_*` التشخيصية. (و) `push_security_status()` + `push_device_status()` للتشخيص بلا كشف أي سرّ |
| `supabase/migrations/20261022090000_…sql` | إزالة السرّ المكتوب حرفياً من الكود (كان `mohanndes-push-webhook-2026`) — صار مولَّداً عشوائياً |
| `supabase/functions/push-notify/index.ts` | قراءة السرّ من Vault (ذاكرة 60 ثانية) + مقارنة بزمن ثابت + **رفض 503 عند غياب السرّ** (fail-closed) + عدم الثقة بـ `is_developer` + تمرير `x-dev-token` + حدّ معدّل على التسجيل |
| `src/lib/push.ts` / `src/lib/webPush.ts` | إرسال `dev_token: getDevToken()` بدل `is_developer` · `getPushDeviceStatus()` + `repairPush()` |
| `src/components/PushStatusCard.tsx` | بطاقة «حالة الإشعارات» في إعدادات الطالب **والمطوّر**: صلاحية النظام + تسجيل الجهاز + تنبيهات المحتوى + (للمطوّر) هل الجهاز مُعلَّم مطوّراً + زر إصلاح بضغطة |

## 3) ترتيب النشر

```text
1. SQL Editor ⇐ نفّذ 20261024090000_push_notifications_hardening.sql   (ملف واحد يكفي: الدالة + التدوير + الحارس)
2. npx supabase functions deploy push-notify --project-ref wulycdwgvpriptzubazi --no-verify-jwt
3. ابنِ APK جديدًا (v34) — يرسل dev_token، فتُعلّم القاعدة جهاز المطوّر بنفسها
4. (اختياري) احذف السرّ WEBHOOK_SECRET من أسرار الدالة إن كان مضبوطاً
```

**لماذا صار الترتيب آمناً في كل الحالات؟**
- التدوير مدموج في نفس ملف الهجرة، والمشغّل يقرأ السرّ من Vault لحظة كل إرسال — فالدالة والمشغّل يقرآن **نفس الصف** دائماً، ولا توجد نافذة `401`.
- هجرة ثم دالة: الدالة القديمة لا تفحص السرّ (fail-open) ⇒ الإشعارات مستمرة، ثم الجديدة تعمل فوراً.
- دالة ثم هجرة: الدالة الجديدة ترفض `503` (فشل مغلق) **بدون أن تفقد شيئاً**، وتعود تلقائياً بعد تنفيذ الهجرة بلا إعادة نشر.
- إعادة تنفيذ الهجرة لا تدوّر سرّاً سليماً (64 خانة hex) ⇒ لا تُسقط إشعارات بالخطأ.


## 4) اختبارات القبول (بعد كل خطوة)

```bash
# (1) أمر واحد يفحص كل شيء (أُضيف في هذا الإصلاح)
select public.push_security_status();
#   المطلوب: dev_guard_triggers = 2 · webhook_secret_rpc = true
#            webhook_secret_readable = true · devices_developer = 0
#            web_devices_developer = 0

# (2) المقارنة مع التشخيص القديم (أعداد فقط) — developer يجب أن يبقى 0
select public.push_diag();

# (3) السرّ غير مقروء للمجهول → 401/42501 (وليس 404!)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/rest/v1/rpc/push_webhook_secret" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"

# (4) السرّ القديم المسرَّب ميت → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/functions/v1/push-notify" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -H "x-webhook-secret: mohanndes-push-webhook-2026" -d '{"title":"x"}'

# (5) نداء مجهول تماماً → 401 (كان 200)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/functions/v1/push-notify" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}'

# (6) التسجيل من التطبيق ما زال يعمل → 200 {"ok":true,"kind":"fcm"}
#     وأنشئ إشعاراً من التطبيق وتحقّق من وصوله والجهاز مغلق (اختبار النهاية)

# (7) ادعاء المطوّر من جهاز طالب → يجب أن يبقى 0 بعد إعادة التسجيل
select public.push_diag();  -- push_tokens_developer = 0
```

> ملاحظة: اختبار (4) يستخدم القيمة المسرَّبة القديمة؛ بعد الخطوة 3 يجب أن يكون الردّ `401` لأن السرّ في Vault صار مختلفاً.

## 5) التراجع (Rollback) — إن لزم

```sql
DROP TRIGGER IF EXISTS push_guard_dev_flag_trigger ON public.push_tokens;
DROP TRIGGER IF EXISTS push_guard_dev_flag_trigger ON public.web_push_subscriptions;
DROP FUNCTION IF EXISTS public.push_guard_dev_flag();
-- إبقاء push_webhook_secret() آمن (لا يضرّ) — والدالة تحتاجه.
```
ثم أعد نشر النسخة السابقة من `push-notify` من git.

> تحذير: التراجع يعيد فتح N2 (ادعاء صفة المطوّر) وN1 (لا سرّ) — لا يُنفَّذ إلا لعطل حقيقي في الإرسال.
