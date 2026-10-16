# Background push setup

The database migration `20261016100000_dispatch_background_push.sql` calls this
function for new notifications, lectures, assignments, exams, reference
materials, and registrations. The calls are asynchronous; publishing content
does not fail if the push service is temporarily unavailable.
If Dashboard Database Webhooks already call this function, remove those old
webhooks before enabling the migration to avoid sending duplicate notifications.

## One-time setup

1. Generate a random secret. Configure it as an Edge Function secret:

   ```powershell
   supabase secrets set WEBHOOK_SECRET=<random-secret>
   ```

2. In the Supabase SQL Editor, store the function URL and the same secret in
   Vault (replace the project ref and secret; run these once):

   ```sql
   select vault.create_secret(
     'https://<project-ref>.supabase.co/functions/v1/push-notify',
     'push_notify_url'
   );
   select vault.create_secret('<random-secret>', 'push_webhook_secret');
   ```

3. Configure `FIREBASE_SERVICE_ACCOUNT` with the Firebase service-account JSON.
   For browser/PWA push, also set `WEBPUSH_VAPID_PRIVATE_KEY` to the private key
   matching the public key in `src/lib/webPush.ts`.

4. Apply database migrations and deploy the function:

   ```powershell
   supabase db push
   supabase functions deploy push-notify
   ```

`supabase/config.toml` disables Supabase's JWT check for this endpoint. Requests
are instead protected by the required `WEBHOOK_SECRET` check in the function.
The database trigger uses the same secret from Vault in the
`x-webhook-secret` header. Keep the secret private and do not commit it.

## Device requirements

- Android: install/open the app once, grant notification permission, and make
  sure the device is registered in `push_tokens`.
- Web/PWA: grant notification permission and install/open the site on a browser
  that supports Push API; the browser subscription is stored in
  `web_push_subscriptions`.
- Android's **Force stop** blocks FCM until the app is opened again. Swiping the
  app from Recents is not Force stop and should not prevent background delivery.
