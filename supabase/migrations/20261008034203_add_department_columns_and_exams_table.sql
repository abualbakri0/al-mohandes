/*
# Add department columns + exams table

1. Modified Tables
- `lectures` — added `department` (text, nullable)
- `assignments` — added `department` (text, nullable)
- `study_tasks` — added `department` (text, nullable)
- `notifications` — added `department` (text, nullable) — null means all departments

2. New Tables
- `exams` — exam schedule with subject, date, start_time, end_time, location, department

3. Security
- No policy changes — existing CRUD policies already allow full access
*/

ALTER TABLE lectures ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE study_tasks ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS department text;

CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  exam_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  location text,
  department text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable select for all on exams"
  ON exams FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Enable insert for all on exams"
  ON exams FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Enable update for all on exams"
  ON exams FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Enable delete for all on exams"
  ON exams FOR DELETE TO anon, authenticated
  USING (true);
