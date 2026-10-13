-- ============================================================================
--  جداول تتبّع تقدّم المستخدم (منفصلة تماماً عن الجداول العامة)
-- ============================================================================
--
--  المشكلة السابقة:
--    كانت حالة الإنجاز تُقرأ من العمود المشترك `assignments.completed`
--    و`study_tasks.completed`، وهذان العمودان عامّان على مستوى الصف الواحد.
--    فأي طالب يضع علامة "صح" كانت تظهر فوراً عند جميع الطلاب.
--
--  الحل:
--    نجعل حالة الإنجاز صفاً مستقلّاً في جدول خاص بكل مستخدم، مفتاحه
--    (user_id, item_id)، فيستحيل أن يشترك طالبان في نفس الصف.
--
--  ملاحظة أمنية مهمة:
--    سياسات RLS هنا واسعة (USING true) لأن التطبيق يستخدم مفتاح anon بدون
--    مصادقة Supabase Auth، فلا يعرف Postgres هوية المستخدم بنفسه. العزل
--    الحقيقي يتحقّق بسببين:
--      1) كل استعلام في الكود مُقيَّد إلزامياً بـ .eq('user_id', <id الجلسة>).
--      2) user_id مأخوذ من جدول registrations (المفتاح الأساسي) ولا يمكن
--         للطالب تعديله من الواجهة.
--    لذلك يجب ألا يُضاف أي استعلام على هذين الجدولين بدون تقييد user_id.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1) تقدّم التكاليف لكل مستخدم
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_assignment_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  assignment_id uuid        NOT NULL REFERENCES assignments(id)     ON DELETE CASCADE,
  completed     boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- صف واحد فقط لكل (مستخدم + تكليف): هدف عملية upsert وضمان العزل.
CREATE UNIQUE INDEX IF NOT EXISTS user_assignment_progress_uidx
  ON user_assignment_progress (user_id, assignment_id);

CREATE INDEX IF NOT EXISTS user_assignment_progress_user_idx
  ON user_assignment_progress (user_id);
CREATE INDEX IF NOT EXISTS user_assignment_progress_assignment_idx
  ON user_assignment_progress (assignment_id);

ALTER TABLE user_assignment_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_assignment_progress" ON user_assignment_progress;
DROP POLICY IF EXISTS "insert_user_assignment_progress" ON user_assignment_progress;
DROP POLICY IF EXISTS "update_user_assignment_progress" ON user_assignment_progress;
DROP POLICY IF EXISTS "delete_user_assignment_progress" ON user_assignment_progress;

CREATE POLICY "select_user_assignment_progress" ON user_assignment_progress FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_user_assignment_progress" ON user_assignment_progress FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_user_assignment_progress" ON user_assignment_progress FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_assignment_progress" ON user_assignment_progress FOR DELETE
  TO anon, authenticated USING (true);


-- ────────────────────────────────────────────────────────────────────────────
--  2) تقدّم المذاكرة لكل مستخدم
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_study_progress (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  task_id    uuid        NOT NULL REFERENCES study_tasks(id)   ON DELETE CASCADE,
  completed  boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_study_progress_uidx
  ON user_study_progress (user_id, task_id);

CREATE INDEX IF NOT EXISTS user_study_progress_user_idx
  ON user_study_progress (user_id);
CREATE INDEX IF NOT EXISTS user_study_progress_task_idx
  ON user_study_progress (task_id);

ALTER TABLE user_study_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_study_progress" ON user_study_progress;
DROP POLICY IF EXISTS "insert_user_study_progress" ON user_study_progress;
DROP POLICY IF EXISTS "update_user_study_progress" ON user_study_progress;
DROP POLICY IF EXISTS "delete_user_study_progress" ON user_study_progress;

CREATE POLICY "select_user_study_progress" ON user_study_progress FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_user_study_progress" ON user_study_progress FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_user_study_progress" ON user_study_progress FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_study_progress" ON user_study_progress FOR DELETE
  TO anon, authenticated USING (true);

-- ────────────────────────────────────────────────────────────────────────────
--  3) ترحيل البيانات الموجودة (إن وُجدت) من الجدولين القديمين.
--     ON CONFLICT DO NOTHING حتى لا نفقد بيانات إن نُفِّذ الترحيل مرتين.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO user_assignment_progress (user_id, assignment_id, completed, updated_at)
SELECT user_id, assignment_id, completed, updated_at
FROM assignment_progress
ON CONFLICT (user_id, assignment_id) DO NOTHING;

INSERT INTO user_study_progress (user_id, task_id, completed, updated_at)
SELECT user_id, task_id, completed, updated_at
FROM study_progress
ON CONFLICT (user_id, task_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
--  4) تصفير الأعمدة المشتركة القديمة.
--     لم يبقَ أي كود يقرأها أو يكتبها؛ تصفيرها يمنع ظهور أي علامة متبقية
--     من فترة الخلل عند جميع الطلاب.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE assignments SET completed = false WHERE completed = true;
UPDATE study_tasks SET completed = false WHERE completed = true;

-- للتحقق بعد التنفيذ (يجب أن تكون كل النتائج 0):
--   SELECT count(*) FROM assignments WHERE completed = true;
--   SELECT count(*) FROM study_tasks WHERE completed = true;
