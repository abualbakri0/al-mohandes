/*
# Create feedback_messages table

## Summary
Adds a "feedback" feature where users can send messages, complaints, or suggestions to the developer. The developer can view and manage all feedback in a dedicated tab. Users see a simple form with message type selection and optional contact info.

## New Tables
- `feedback_messages`
  - `id` (uuid, primary key)
  - `sender_name` (text, not null) — name of the person sending feedback
  - `sender_phone` (text, nullable) — optional phone for follow-up
  - `message_type` (text, not null) — 'complaint' | 'suggestion' | 'question' | 'other'
  - `subject` (text, not null) — short subject line
  - `message` (text, not null) — full message body
  - `is_read` (boolean, default false) — tracks whether the developer has read it
  - `created_at` (timestamptz, default now())

## Security
- RLS enabled on `feedback_messages` table
- SELECT/INSERT/UPDATE/DELETE: `TO anon, authenticated` (no-auth app, data is intentionally shared)
*/

CREATE TABLE IF NOT EXISTS feedback_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name text NOT NULL,
  sender_phone text,
  message_type text NOT NULL DEFAULT 'other',
  subject text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_feedback" ON feedback_messages;
CREATE POLICY "anon_select_feedback"
ON feedback_messages FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_feedback" ON feedback_messages;
CREATE POLICY "anon_insert_feedback"
ON feedback_messages FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_feedback" ON feedback_messages;
CREATE POLICY "anon_update_feedback"
ON feedback_messages FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_feedback" ON feedback_messages;
CREATE POLICY "anon_delete_feedback"
ON feedback_messages FOR DELETE
TO anon, authenticated USING (true);