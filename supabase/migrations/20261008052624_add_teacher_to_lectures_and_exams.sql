/*
# Add teacher column to lectures and exams

1. Modified Tables
- `lectures`: adds `teacher` (text, nullable) — name of the instructor for the lecture.
- `exams`: adds `teacher` (text, nullable) — name of the instructor for the exam.

2. Security
- No RLS changes needed; existing policies already allow full CRUD for anon + authenticated.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lectures' AND column_name = 'teacher') THEN
    ALTER TABLE lectures ADD COLUMN teacher text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'teacher') THEN
    ALTER TABLE exams ADD COLUMN teacher text;
  END IF;
END $$;
