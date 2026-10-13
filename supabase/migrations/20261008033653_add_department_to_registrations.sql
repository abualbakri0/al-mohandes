/*
# Add department column to registrations table

1. Modified Tables
- `registrations`
  - Added `department` (text, nullable) — stores the user's selected department
    ('ميكاترونكس' or 'كهربائية')
2. Security
- No policy changes — existing CRUD policies already allow full access
*/

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS department text;
