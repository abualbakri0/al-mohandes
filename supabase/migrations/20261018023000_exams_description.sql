-- Documents the exams.description column (exam explanation/topics).
-- Applied live earlier; kept here so a fresh DB setup keeps the field.
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
