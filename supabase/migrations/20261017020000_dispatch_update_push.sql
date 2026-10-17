-- Background push v2: also notify on EDIT (UPDATE) of content rows.
-- The INSERT triggers already exist (20261017010000). This migration:
--   1. Extends dispatch_background_push() to include old_record for UPDATEs
--      so the Edge Function can skip no-op saves (same content-field diff as
--      src/hooks/useOfficialRealtime.ts).
--   2. Adds AFTER UPDATE triggers on the 5 content tables.
--
-- Deliberately NOT added (matching the frontend behaviour):
--   * registrations  — approval is a developer-only action, never broadcast.
--   * feedback_messages — is_read toggles must not push.
--   * study_tasks    — students toggle `completed` (would spam everyone);
--                      study-task background push was never in scope.
-- The Edge Function also ignores per-user columns (e.g. assignments.completed)
-- via its CONTENT_FIELDS diff, so legacy progress writes can't spam either.

CREATE OR REPLACE FUNCTION public.dispatch_background_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  push_url text;
  webhook_secret text;
  anon_key text;
  payload jsonb;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regnamespace('net') IS NULL THEN
    RAISE WARNING 'Background push is not configured: enable Supabase Vault and pg_net';
    RETURN NEW;
  END IF;

  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO push_url USING 'push_notify_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO webhook_secret USING 'push_webhook_secret';
  -- Supabase API gateway requires an Authorization (anon key) header even
  -- when the function's own JWT check is OFF; without it the gateway
  -- returns 401 UNAUTHORIZED_NO_AUTH_HEADER before our code ever runs.
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO anon_key USING 'supabase_anon_key';

  IF COALESCE(push_url, '') = '' OR COALESCE(webhook_secret, '') = '' THEN
    RAISE WARNING 'Background push is not configured: add push_notify_url and push_webhook_secret to Supabase Vault';
    RETURN NEW;
  END IF;
  IF COALESCE(anon_key, '') = '' THEN
    RAISE WARNING 'Background push is not configured: add supabase_anon_key (anon public key) to Supabase Vault';
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', to_jsonb(NEW)
  );
  IF TG_OP = 'UPDATE' THEN
    -- Always the full old row inside a plpgsql row trigger (independent of
    -- REPLICA IDENTITY), so the Edge Function can diff content fields.
    payload := payload || jsonb_build_object('old_record', to_jsonb(OLD));
  END IF;

  EXECUTE 'SELECT net.http_post($1, $2, ''{}''::jsonb, $3, 5000)'
    USING
      push_url,
      payload,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', webhook_secret,
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key
      );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block publishing content if the external push service is unavailable.
  RAISE WARNING 'Background push dispatch failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  RETURN NEW;
END;
$$;

-- UPDATE triggers (content tables only — see header comment).
DROP TRIGGER IF EXISTS dispatch_upd_push_notifications ON public.notifications;
CREATE TRIGGER dispatch_upd_push_notifications
AFTER UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_upd_push_lectures ON public.lectures;
CREATE TRIGGER dispatch_upd_push_lectures
AFTER UPDATE ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_upd_push_assignments ON public.assignments;
CREATE TRIGGER dispatch_upd_push_assignments
AFTER UPDATE ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_upd_push_exams ON public.exams;
CREATE TRIGGER dispatch_upd_push_exams
AFTER UPDATE ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_upd_push_references ON public.reference_materials;
CREATE TRIGGER dispatch_upd_push_references
AFTER UPDATE ON public.reference_materials
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();
