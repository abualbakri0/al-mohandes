/*
# Full consolidated schema for the "المهندس" university schedule app
# (applied to the developer's own Supabase project)

Recreates every table the app needs, plus the new `user_passwords` table
that powers the in-app password authentication. RLS enabled on all tables
with full CRUD for anon + authenticated (shared, no-auth app).
*/

-- registrations
CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  department text,
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_registrations" ON registrations;
CREATE POLICY "anon_select_registrations" ON registrations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_registrations" ON registrations;
CREATE POLICY "anon_insert_registrations" ON registrations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_registrations" ON registrations;
CREATE POLICY "anon_update_registrations" ON registrations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_registrations" ON registrations;
CREATE POLICY "anon_delete_registrations" ON registrations FOR DELETE TO anon, authenticated USING (true);

-- user_passwords (in-app password authentication)
CREATE TABLE IF NOT EXISTS user_passwords (
  phone text PRIMARY KEY,
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_passwords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_user_passwords" ON user_passwords;
CREATE POLICY "anon_select_user_passwords" ON user_passwords FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_user_passwords" ON user_passwords;
CREATE POLICY "anon_insert_user_passwords" ON user_passwords FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_user_passwords" ON user_passwords;
CREATE POLICY "anon_update_user_passwords" ON user_passwords FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_user_passwords" ON user_passwords;
CREATE POLICY "anon_delete_user_passwords" ON user_passwords FOR DELETE TO anon, authenticated USING (true);

-- lectures
CREATE TABLE IF NOT EXISTS lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  day text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  location text,
  department text,
  teacher text,
  is_holiday boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false;
DROP POLICY IF EXISTS "anon_select_lectures" ON lectures;
CREATE POLICY "anon_select_lectures" ON lectures FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_lectures" ON lectures;
CREATE POLICY "anon_insert_lectures" ON lectures FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_lectures" ON lectures;
CREATE POLICY "anon_update_lectures" ON lectures FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_lectures" ON lectures;
CREATE POLICY "anon_delete_lectures" ON lectures FOR DELETE TO anon, authenticated USING (true);

-- assignments
CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  title text NOT NULL,
  request_date date NOT NULL,
  due_date date NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  department text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_assignments" ON assignments;
CREATE POLICY "anon_select_assignments" ON assignments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_assignments" ON assignments;
CREATE POLICY "anon_insert_assignments" ON assignments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_assignments" ON assignments;
CREATE POLICY "anon_update_assignments" ON assignments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_assignments" ON assignments;
CREATE POLICY "anon_delete_assignments" ON assignments FOR DELETE TO anon, authenticated USING (true);

-- study_tasks
CREATE TABLE IF NOT EXISTS study_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  task_type text NOT NULL DEFAULT 'review',
  day text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  department text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE study_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_study_tasks" ON study_tasks;
CREATE POLICY "anon_select_study_tasks" ON study_tasks FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_study_tasks" ON study_tasks;
CREATE POLICY "anon_insert_study_tasks" ON study_tasks FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_study_tasks" ON study_tasks;
CREATE POLICY "anon_update_study_tasks" ON study_tasks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_study_tasks" ON study_tasks;
CREATE POLICY "anon_delete_study_tasks" ON study_tasks FOR DELETE TO anon, authenticated USING (true);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  notification_type text NOT NULL DEFAULT 'general',
  department text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
CREATE POLICY "anon_select_notifications" ON notifications FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_notifications" ON notifications;
CREATE POLICY "anon_insert_notifications" ON notifications FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_notifications" ON notifications;
CREATE POLICY "anon_delete_notifications" ON notifications FOR DELETE TO anon, authenticated USING (true);

-- exams
CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  exam_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  location text,
  department text,
  teacher text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_exams" ON exams;
CREATE POLICY "select_exams" ON exams FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_exams" ON exams;
CREATE POLICY "insert_exams" ON exams FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_exams" ON exams;
CREATE POLICY "update_exams" ON exams FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_exams" ON exams;
CREATE POLICY "delete_exams" ON exams FOR DELETE TO anon, authenticated USING (true);

-- app_settings (single row of developer controls)
CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_password text NOT NULL DEFAULT '1234',
  academic_level text NOT NULL DEFAULT 'المستوى الأول',
  semester text NOT NULL DEFAULT 'الترم الأول',
  semester_start_date date,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO app_settings (dev_password, academic_level, semester)
SELECT '1234', 'المستوى الأول', 'الترم الأول'
WHERE NOT EXISTS (SELECT 1 FROM app_settings);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_app_settings" ON app_settings;
CREATE POLICY "anon_select_app_settings" ON app_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_app_settings" ON app_settings;
CREATE POLICY "anon_insert_app_settings" ON app_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_app_settings" ON app_settings;
CREATE POLICY "anon_update_app_settings" ON app_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_app_settings" ON app_settings;
CREATE POLICY "anon_delete_app_settings" ON app_settings FOR DELETE TO anon, authenticated USING (true);

-- reference_materials (PDF references metadata)
CREATE TABLE IF NOT EXISTS reference_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_size bigint,
  department text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE reference_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_reference_materials" ON reference_materials;
CREATE POLICY "anon_select_reference_materials" ON reference_materials FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_reference_materials" ON reference_materials;
CREATE POLICY "anon_insert_reference_materials" ON reference_materials FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_reference_materials" ON reference_materials;
CREATE POLICY "anon_update_reference_materials" ON reference_materials FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_reference_materials" ON reference_materials;
CREATE POLICY "anon_delete_reference_materials" ON reference_materials FOR DELETE TO anon, authenticated USING (true);

-- feedback_messages
CREATE TABLE IF NOT EXISTS feedback_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name text NOT NULL,
  sender_phone text,
  message_type text NOT NULL DEFAULT 'other',
  subject text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_feedback" ON feedback_messages;
CREATE POLICY "anon_select_feedback" ON feedback_messages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_feedback" ON feedback_messages;
CREATE POLICY "anon_insert_feedback" ON feedback_messages FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_feedback" ON feedback_messages;
CREATE POLICY "anon_update_feedback" ON feedback_messages FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_feedback" ON feedback_messages;
CREATE POLICY "anon_delete_feedback" ON feedback_messages FOR DELETE TO anon, authenticated USING (true);

-- Storage bucket for reference PDFs (public read, open write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('references', 'references', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Public read references bucket" ON storage.objects;
CREATE POLICY "Public read references bucket" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'references');
DROP POLICY IF EXISTS "Anyone can upload references" ON storage.objects;
CREATE POLICY "Anyone can upload references" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'references');
DROP POLICY IF EXISTS "Anyone can delete references" ON storage.objects;
CREATE POLICY "Anyone can delete references" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'references');


