-- FCM push tokens — lets the Edge Function `push-notify` reach devices even
-- when the app is fully closed (Supabase Realtime cannot do that).
-- One row per device. Client upserts (token as PK) from src/lib/push.ts.
-- RLS style mirrors every other table in this app (open to anon).

CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  department TEXT,                                  -- mirrors user department; NULL = unknown yet
  platform TEXT NOT NULL DEFAULT 'android',
  alerts_enabled BOOLEAN NOT NULL DEFAULT true,     -- mirrors "تنبيهات المحتوى" pref
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_push_tokens" ON push_tokens;
CREATE POLICY "anon_select_push_tokens" ON push_tokens FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_push_tokens" ON push_tokens;
CREATE POLICY "anon_insert_push_tokens" ON push_tokens FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_push_tokens" ON push_tokens;
CREATE POLICY "anon_update_push_tokens" ON push_tokens FOR UPDATE
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_delete_push_tokens" ON push_tokens;
CREATE POLICY "anon_delete_push_tokens" ON push_tokens FOR DELETE
TO anon, authenticated USING (true);
