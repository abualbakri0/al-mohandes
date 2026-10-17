-- Background push: DB trigger -> pg_net -> push-notify Edge Function.
-- Documents the dispatch setup that currently exists in the production DB
-- (function + 6 triggers) so a fresh database can be rebuilt from migrations.
--
-- Requires: extensions pg_net (schema net) and supabase_vault, plus Vault
-- secrets: push_notify_url, push_webhook_secret, supabase_anon_key.
--
-- NOTE: the Edge Function must NOT have the optional WEBHOOK_SECRET env var
-- set while this trigger is used — the function compares the Authorization
-- header (which carries the anon key here) against it, which makes every
-- call fail with 401. Keep it unset; the secret check is optional.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

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

-- Content tables: pushed to every matching device.
DROP TRIGGER IF EXISTS dispatch_push_notifications ON public.notifications;
CREATE TRIGGER dispatch_push_notifications
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_push_lectures ON public.lectures;
CREATE TRIGGER dispatch_push_lectures
AFTER INSERT ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_push_assignments ON public.assignments;
CREATE TRIGGER dispatch_push_assignments
AFTER INSERT ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_push_exams ON public.exams;
CREATE TRIGGER dispatch_push_exams
AFTER INSERT ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

DROP TRIGGER IF EXISTS dispatch_push_references ON public.reference_materials;
CREATE TRIGGER dispatch_push_references
AFTER INSERT ON public.reference_materials
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();

-- Registrations: developer devices only (Edge Function filters
-- push_tokens to is_developer = true for this table).
DROP TRIGGER IF EXISTS dispatch_push_registrations ON public.registrations;
CREATE TRIGGER dispatch_push_registrations
AFTER INSERT ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.dispatch_background_push();
