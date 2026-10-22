-- ============================================================
-- RUN-THIS-OPTIONAL-harden-storage.sql   (اختياري — نفّذه بعد الملف الأساسي)
-- تقييد رفع/حذف ملفات المراجع على المطوّر فقط
-- ------------------------------------------------------------
-- قبل هذا الملف: أي شخص يملك المفتاح العام يستطيع حذف ملفات PDF من دلو
-- references أو رفع ملفات بديلة.
--
-- بعد هذا الملف: الرفع والحذف يحتاجان توكين المطوّر (x-dev-token) الذي
-- يرسله التطبيق تلقائياً. القراءة تبقى عامة كما هي (الروابط لا تتغيّر).
--
-- ⚠️ سبب كونه منفصلاً: يعتمد على أن خدمة Storage تُمرّر هيدرات الطلب إلى
--    قاعدة البيانات. هذا يُتحقّق منه بالتجربة فقط.
--
-- خطوات التنفيذ:
--   1) نفّذ الملف في Supabase SQL Editor.
--   2) سجّل دخول المطوّر في التطبيق، ثم ارفع ملف PDF صغيراً من «المراجع».
--   3) نجح الرفع؟  → تمّت الحماية. احتفظ بالملف.
--   4) فشل الرفع؟  → نفّذ قسم «التراجع» في الأسفل (سطران) وأبلغ المطوّر.
--
-- التراجع (في حال فشل الرفع):
--   DROP POLICY IF EXISTS "dev_upload_references" ON storage.objects;
--   DROP POLICY IF EXISTS "dev_delete_references" ON storage.objects;
--   CREATE POLICY "Anyone can upload references" ON storage.objects
--     FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'references');
--   CREATE POLICY "Anyone can delete references" ON storage.objects
--     FOR DELETE TO anon, authenticated USING (bucket_id = 'references');
-- ============================================================

DROP POLICY IF EXISTS "Anyone can upload references" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete references" ON storage.objects;
DROP POLICY IF EXISTS "dev_upload_references" ON storage.objects;
DROP POLICY IF EXISTS "dev_delete_references" ON storage.objects;

CREATE POLICY "dev_upload_references" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'references' AND (SELECT public.dev_token_ok()));

CREATE POLICY "dev_delete_references" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'references' AND (SELECT public.dev_token_ok()));

-- تأكيد أن دالة التحقق موجودة (من الملف الأساسي):
--   SELECT public.dev_token_ok();
-- (تُرجع false بلا هيدر — وهذا هو المتوقع.)
