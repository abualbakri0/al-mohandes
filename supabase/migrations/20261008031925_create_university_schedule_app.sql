/*
# University Schedule App - Database Schema

1. New Tables
- `registrations` — stores user name and phone number from the registration form
  - id (uuid, primary key)
  - name (text, not null) — user's full name
  - phone (text, not null) — user's phone number
  - created_at (timestamptz)
- `lectures` — university lecture schedule entries
  - id (uuid, primary key)
  - subject (text, not null) — subject name
  - day (text, not null) — day of week (السبت، الأحد، ...)
  - start_time (text, not null) — start time e.g. "08:00"
  - end_time (text, not null) — end time e.g. "10:00"
  - location (text) — room/hall location
  - created_at (timestamptz)
- `assignments` — homework/assignments with request and due dates
  - id (uuid, primary key)
  - subject (text, not null)
  - title (text, not null) — assignment title
  - request_date (date, not null) — when the assignment was requested
  - due_date (date, not null) — last submission date
  - completed (boolean, default false)
  - created_at (timestamptz)
- `study_tasks` — study schedule tasks linked to lectures
  - id (uuid, primary key)
  - subject (text, not null)
  - task_type (text, not null) — 'review' or 'prestudy'
  - day (text, not null) — day of week
  - start_time (text, not null)
  - end_time (text, not null)
  - completed (boolean, default false)
  - created_at (timestamptz)
- `notifications` — announcements sent to users
  - id (uuid, primary key)
  - title (text, not null)
  - message (text, not null)
  - notification_type (text, not null) — 'postponement', 'general', 'reminder'
  - created_at (timestamptz)

2. Security
- All tables use single-tenant (no auth) — TO anon, authenticated with USING (true)
- This is intentional: the app is a shared university schedule with no sign-in screen
- RLS enabled on every table
- 4 CRUD policies per table (select/insert/update/delete)
*/