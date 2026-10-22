-- ============================================================================
-- إزالة مشغّلات الإرسال القديمة المكررة (إصلاح الإشعار المكرر عند إغلاق التطبيق)
-- ============================================================================
-- المشكلة:
--   ترحيل 20261022090000 أنشأ مشغّلات جديدة push_dispatch_* تستدعي
--   dispatch_push_webhook()، لكنه لم يحذف المشغّلات القديمة
--   dispatch_push_* (INSERT) و dispatch_upd_push_* (UPDATE) القادمة من
--   الترحيلين 20261017010000 و 20261017020000 والتي تستدعي
--   dispatch_background_push().
--   النتيجة: عند إضافة أو تعديل أي محتوى يصل الحدث مرتين إلى دالة
--   push-notify → إشعاران مكرران لكل مستخدم (يظهران بوضوح عندما يكون
--   التطبيق مغلقاً).
--
-- الحل:
--   حذف المشغّلات القديمة والدالة القديمة، مع بقاء المشغّلات الجديدة فقط
--   push_dispatch_* (إشعار واحد فقط لكل حدث). لا يمس التطبيق ولا نظام
--   الإشعارات في الواجهة ولا أي سياسة أمنية.
-- ============================================================================

-- مشغّلات INSERT القديمة (كانت من 20261017010000) — بأسمائها الدقيقة في قاعدة البيانات
DROP TRIGGER IF EXISTS dispatch_push_notifications ON public.notifications;
DROP TRIGGER IF EXISTS dispatch_push_lectures ON public.lectures;
DROP TRIGGER IF EXISTS dispatch_push_assignments ON public.assignments;
DROP TRIGGER IF EXISTS dispatch_push_exams ON public.exams;
DROP TRIGGER IF EXISTS dispatch_push_references ON public.reference_materials;
DROP TRIGGER IF EXISTS dispatch_push_registrations ON public.registrations;

-- مشغّلات UPDATE القديمة (كانت من 20261017020000) — بأسمائها الدقيقة في قاعدة البيانات
DROP TRIGGER IF EXISTS dispatch_upd_push_notifications ON public.notifications;
DROP TRIGGER IF EXISTS dispatch_upd_push_lectures ON public.lectures;
DROP TRIGGER IF EXISTS dispatch_upd_push_assignments ON public.assignments;
DROP TRIGGER IF EXISTS dispatch_upd_push_exams ON public.exams;
DROP TRIGGER IF EXISTS dispatch_upd_push_references ON public.reference_materials;

-- الدالة القديمة — لم يعد يستخدمها أي مشغّل بعد الآن.
DROP FUNCTION IF EXISTS public.dispatch_background_push();

-- للتحقق بعد التنفيذ (يجب أن ترى فقط push_dispatch_* وليس dispatch_push_* أو dispatch_upd_push_*):
--   SELECT tgname, c.relname
--     FROM pg_trigger tg
--     JOIN pg_class c ON c.oid = tg.tgrelid
--    WHERE tg.tgname LIKE '%push%' AND NOT tg.tgisinternal
--    ORDER BY c.relname, tg.tgname;
