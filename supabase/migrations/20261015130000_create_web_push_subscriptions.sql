-- Web Push subscriptions (PWA / website installs) — lets the Edge Function
-- `push-notify` reach installed websites even when the browser is closed.
-- One row per browser subscription; client upserts from src/lib/webPush.ts.
-- RLS mirrors push_tokens (open to anon).

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  department TEXT,
  is_developer BOOLEAN NOT NULL DEFAULT false,
  alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_select_web_push" ON web_push_subscriptions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_insert_web_push" ON web_push_subscriptions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_update_web_push" ON web_push_subscriptions FOR UPDATE
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_delete_web_push" ON web_push_subscriptions;
CREATE POLICY "anon_delete_web_push" ON web_push_subscriptions FOR DELETE
TO anon, authenticated USING (true);
