-- ============================================================================
-- عزل تقدم الطلاب (المذاكرة + التكاليف) — نسخة مكتفية ذاتياً وقابلة لإعادة التنفيذ.
-- ============================================================================
-- المشكلة:
--   كانت حالة الإنجاز تُقرأ وتُكتب في العمود المشترك `assignments.completed`
--   و`study_tasks.completed`. هذان العمودان عامّان على مستوى الصف الواحد، فأي
--   طالب يضع علامة "صح" كانت تظهر فوراً عند جميع الطلاب.
--
-- الحل:
--   نجعل حالة الإنجاز صفاً مستقلّاً في جدول خاص بكل مستخدم، مفتاحه
--   (user_id, item_id)، فيستحيل أن يشترك طالبان في نفس الصف:
--     - user_assignment_progress  (user_id, assignment_id)  ← التكاليف
--     - user_study_progress       (user_id, task_id)        ← المذاكرة
--   ثم نُصفّر الأعمدة المشتركة القديمة حتى لا تظهر أي علامة متبقية عند الجميع.
--
-- ملاحظات:
--   * الملف Idempotent بالكامل: يمكن تنفيذه أكثر من مرة دون ضرر.
--   * لا يمس نظام الإشعارات، ولا أي سياسة أمنية/RLS قائمة خارج هذين الجدولين.
--   * العزل في طبقة التطبيق يعتمد على فلترة user_id في كل استعلام (مطبّق
--     بالفعل في src/lib/api.ts)؛ الجداول هنا توفر فقط التخزين المنفصل.
-- ============================================================================

-- ── 1) تقدم التكاليف لكل مستخدم ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_assignment_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  completed     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- صف واحد فقط لكل (مستخدم + تكليف): هدف عملية upsert وضمان العزل.
CREATE UNIQUE INDEX IF NOT EXISTS user_assignment_progress_uidx
  ON public.user_assignment_progress (user_id, assignment_id);
CREATE INDEX IF NOT EXISTS user_assignment_progress_user_idx
  ON public.user_assignment_progress (user_id);
CREATE INDEX IF NOT EXISTS user_assignment_progress_assignment_idx
  ON public.user_assignment_progress (assignment_id);

ALTER TABLE public.user_assignment_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_assignment_progress" ON public.user_assignment_progress;
DROP POLICY IF EXISTS "insert_user_assignment_progress" ON public.user_assignment_progress;
DROP POLICY IF EXISTS "update_user_assignment_progress" ON public.user_assignment_progress;
DROP POLICY IF EXISTS "delete_user_assignment_progress" ON public.user_assignment_progress;

CREATE POLICY "select_user_assignment_progress" ON public.user_assignment_progress FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_user_assignment_progress" ON public.user_assignment_progress FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_user_assignment_progress" ON public.user_assignment_progress FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_assignment_progress" ON public.user_assignment_progress FOR DELETE
  TO anon, authenticated USING (true);

-- ── 2) تقدم المذاكرة لكل مستخدم ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_study_progress (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES study_tasks(id) ON DELETE CASCADE,
  completed  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_study_progress_uidx
  ON public.user_study_progress (user_id, task_id);
CREATE INDEX IF NOT EXISTS user_study_progress_user_idx
  ON public.user_study_progress (user_id);
CREATE INDEX IF NOT EXISTS user_study_progress_task_idx
  ON public.user_study_progress (task_id);

ALTER TABLE public.user_study_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_study_progress" ON public.user_study_progress;
DROP POLICY IF EXISTS "insert_user_study_progress" ON public.user_study_progress;
DROP POLICY IF EXISTS "update_user_study_progress" ON public.user_study_progress;
DROP POLICY IF EXISTS "delete_user_study_progress" ON public.user_study_progress;

CREATE POLICY "select_user_study_progress" ON public.user_study_progress FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_user_study_progress" ON public.user_study_progress FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_user_study_progress" ON public.user_study_progress FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_study_progress" ON public.user_study_progress FOR DELETE
  TO anon, authenticated USING (true);

-- ── 3) ترحيل أي بيانات إنجاز قديمة (إن وُجدت الجداول القديمة). ─────────────
--       نستخدم to_regclass + استثناء داخلي حتى لا يفشل الترحيل إذا كانت
--       الجداول القديمة غير موجودة (مثل الإعداد عبر setup-and-import.cjs).
DO $$
BEGIN
  IF to_regclass('public.assignment_progress') IS NOT NULL
     AND to_regclass('public.user_assignment_progress') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.user_assignment_progress (user_id, assignment_id, completed, updated_at)
      SELECT user_id::uuid, assignment_id, completed, updated_at
        FROM public.assignment_progress
      ON CONFLICT (user_id, assignment_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'assignment_progress migration skipped: %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.study_progress') IS NOT NULL
     AND to_regclass('public.user_study_progress') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.user_study_progress (user_id, task_id, completed, updated_at)
      SELECT user_id::uuid, task_id, completed, updated_at
        FROM public.study_progress
      ON CONFLICT (user_id, task_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'study_progress migration skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── 4) تصفير الأعمدة المشتركة القديمة. ─────────────────────────────────────
--       لم يعد أي كود يقرأها أو يكتبها؛ تصفيرها يمنع ظهور أي علامة متبقية
--       من فترة الخلل عند جميع الطلاب.
UPDATE assignments SET completed = false WHERE completed = true;
UPDATE study_tasks SET completed = false WHERE completed = true;

-- للتحقق بعد التنفيذ (يجب أن تكون كل النتائج 0):
--   SELECT count(*) FROM assignments WHERE completed = true;
--   SELECT count(*) FROM study_tasks WHERE completed = true;

