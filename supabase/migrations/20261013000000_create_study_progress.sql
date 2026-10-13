-- Per-student study progress. The old `study_tasks.completed` flag was shared
-- across every student in a department, so one student's checkmark was visible
-- to all. This table stores each student's own completion state privately:
-- one row per (task_id, user_id). The student's device also keeps an instant
-- copy in localStorage, so the UI works offline and before this migration runs;
-- rows here simply sync that state across the student's devices.
-- user_id is the registrations.id (text) of the logged-in student.

CREATE TABLE IF NOT EXISTS study_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id text NOT NULL,
  completed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One progress row per task per student (upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS study_progress_task_user_uidx
  ON study_progress (task_id, user_id);

-- Fast lookups by owner and by task (developer stats).
CREATE INDEX IF NOT EXISTS study_progress_user_idx ON study_progress (user_id);
CREATE INDEX IF NOT EXISTS study_progress_task_idx ON study_progress (task_id);

ALTER TABLE study_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_study_progress" ON study_progress;
CREATE POLICY "anon_select_study_progress" ON study_progress FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_study_progress" ON study_progress;
CREATE POLICY "anon_insert_study_progress" ON study_progress FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_study_progress" ON study_progress;
CREATE POLICY "anon_update_study_progress" ON study_progress FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_study_progress" ON study_progress;
CREATE POLICY "anon_delete_study_progress" ON study_progress FOR DELETE
TO anon, authenticated USING (true);
