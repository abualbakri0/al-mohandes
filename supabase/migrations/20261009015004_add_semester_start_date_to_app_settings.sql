/*
# Add semester start date to app_settings

1. Modified Tables
- `app_settings`: adds `semester_start_date` column (date, nullable) to store
  the start date of the academic semester. The developer sets this once, and
  the app automatically calculates the current week number from it.
2. Security
- No changes to existing RLS policies. The column is readable/writable through
  the same existing policies that govern app_settings.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_settings' AND column_name = 'semester_start_date'
  ) THEN
    ALTER TABLE app_settings ADD COLUMN semester_start_date date;
  END IF;
END $$;
