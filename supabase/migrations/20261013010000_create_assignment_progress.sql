-- Per-student assignment progress (private checkmarks per student).
-- Mirrors study_progress: each student's completion lives in its own row
-- so one student's checkmark never shows for anyone else.
CREATE TABLE IF NOT EXISTS assignment_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  user_id text NOT NULL,
  completed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS assignment_progress_assignment_user_uidx
  ON assignment_progress (assignment_id, user_id);

CREATE INDEX IF NOT EXISTS assignment_progress_user_idx ON assignment_progress (user_id);
CREATE INDEX IF NOT EXISTS assignment_progress_assignment_idx ON assignment_progress (assignment_id);

ALTER TABLE assignment_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_assignment_progress" ON assignment_progress;
CREATE POLICY "anon_select_assignment_progress" ON assignment_progress FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_assignment_progress" ON assignment_progress;
CREATE POLICY "anon_insert_assignment_progress" ON assignment_progress FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_assignment_progress" ON assignment_progress;
CREATE POLICY "anon_update_assignment_progress" ON assignment_progress FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_assignment_progress" ON assignment_progress;
CREATE POLICY "anon_delete_assignment_progress" ON assignment_progress FOR DELETE
TO anon, authenticated USING (true);
