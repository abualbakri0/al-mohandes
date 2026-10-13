-- Optional free-text explanation on a study task ("الشرح").
-- The teacher/developer writes a short explanation of what to study for that
-- task; students see it under the task title in the Study section.
-- Nullable: existing rows keep NULL and the card simply hides the block.

ALTER TABLE study_tasks ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN study_tasks.notes IS
  'شرح المهمة (اختياري) — يظهر للطالب أسفل اسم المادة.';
