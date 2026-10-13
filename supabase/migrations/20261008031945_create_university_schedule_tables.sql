CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_registrations" ON registrations;
CREATE POLICY "anon_select_registrations" ON registrations FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_registrations" ON registrations;
CREATE POLICY "anon_insert_registrations" ON registrations FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_registrations" ON registrations;
CREATE POLICY "anon_update_registrations" ON registrations FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_registrations" ON registrations;
CREATE POLICY "anon_delete_registrations" ON registrations FOR DELETE
TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  day text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  location text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_lectures" ON lectures;
CREATE POLICY "anon_select_lectures" ON lectures FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_lectures" ON lectures;
CREATE POLICY "anon_insert_lectures" ON lectures FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_lectures" ON lectures;
CREATE POLICY "anon_update_lectures" ON lectures FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_lectures" ON lectures;
CREATE POLICY "anon_delete_lectures" ON lectures FOR DELETE
TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  title text NOT NULL,
  request_date date NOT NULL,
  due_date date NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_assignments" ON assignments;
CREATE POLICY "anon_select_assignments" ON assignments FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_assignments" ON assignments;
CREATE POLICY "anon_insert_assignments" ON assignments FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_assignments" ON assignments;
CREATE POLICY "anon_update_assignments" ON assignments FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_assignments" ON assignments;
CREATE POLICY "anon_delete_assignments" ON assignments FOR DELETE
TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS study_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  task_type text NOT NULL DEFAULT 'review',
  day text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE study_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_study_tasks" ON study_tasks;
CREATE POLICY "anon_select_study_tasks" ON study_tasks FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_study_tasks" ON study_tasks;
CREATE POLICY "anon_insert_study_tasks" ON study_tasks FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_study_tasks" ON study_tasks;
CREATE POLICY "anon_update_study_tasks" ON study_tasks FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_study_tasks" ON study_tasks;
CREATE POLICY "anon_delete_study_tasks" ON study_tasks FOR DELETE
TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  notification_type text NOT NULL DEFAULT 'general',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
CREATE POLICY "anon_select_notifications" ON notifications FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_notifications" ON notifications;
CREATE POLICY "anon_insert_notifications" ON notifications FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_notifications" ON notifications;
CREATE POLICY "anon_delete_notifications" ON notifications FOR DELETE
TO anon, authenticated USING (true);