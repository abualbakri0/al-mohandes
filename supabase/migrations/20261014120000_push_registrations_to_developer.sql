-- Mark developer devices so background registration alerts are never sent to students.
ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS is_developer BOOLEAN NOT NULL DEFAULT false;