/*
# Add is_approved column to registrations

1. Modified Tables
- `registrations`: adds `is_approved` (boolean, default false) — controls whether a user can access the app.

2. Security
- No RLS changes needed; existing policies already allow full CRUD for anon + authenticated.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'is_approved') THEN
    ALTER TABLE registrations ADD COLUMN is_approved boolean NOT NULL DEFAULT false;
  END IF;
END $$;
