/*
# Add password authentication to registrations

1. Modified Tables
- `registrations`
  - Added `password_hash` (text, nullable) — a salted SHA-256 hash of the
    user's password (salt = phone number). NULL means the user has not set a
    password yet and must create one on their first login.
  - Added `must_change_password` (boolean, default false) — when true the user
    is forced to create a new password right after their next successful login
    (used after a developer-initiated password reset).

2. Security
- No RLS policy changes — the existing anon CRUD policies already cover the
  new columns.
*/

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
