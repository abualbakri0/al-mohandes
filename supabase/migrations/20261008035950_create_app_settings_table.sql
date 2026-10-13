/*
# Add app_settings table for developer controls

1. New Tables
- `app_settings` — single-row table storing developer password, current academic level, and semester

2. Security
- Public read access (settings need to be visible to all users)
- Public insert/update/delete (developer manages these)
*/

CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_password text NOT NULL DEFAULT '1234',
  academic_level text NOT NULL DEFAULT 'المستوى الأول',
  semester text NOT NULL DEFAULT 'الترم الأول',
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_settings (dev_password, academic_level, semester)
SELECT '1234', 'المستوى الأول', 'الترم الأول'
WHERE NOT EXISTS (SELECT 1 FROM app_settings);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable select for all on app_settings"
  ON app_settings FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Enable insert for all on app_settings"
  ON app_settings FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Enable update for all on app_settings"
  ON app_settings FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Enable delete for all on app_settings"
  ON app_settings FOR DELETE TO anon, authenticated
  USING (true);
