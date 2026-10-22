/**
 * ── Developer grant token (client plumbing) ────────────────────────────────
 * The signed grant issued by the `verify_developer_code` RPC (HMAC over
 * dev_password, 30-day expiry) is stored in localStorage under `dev_grant`.
 *
 * This module is the single place that owns that key, so the Supabase client
 * can attach it to every request as the `x-dev-token` header. PostgREST exposes
 * request headers to RLS via `current_setting('request.headers')`, which is what
 * `public.dev_token_ok()` checks — i.e. writes are authorised server-side, not
 * by a client-side flag.
 *
 * Students never have a token, so the header is simply absent for them and the
 * read policies keep working exactly as before.
 */

/** localStorage key of the signed developer grant (do not rename). */
export const DEV_GRANT_STORAGE_KEY = 'dev_grant';

/** Header used to transport the grant token to PostgREST / Storage. */
export const DEV_TOKEN_HEADER = 'x-dev-token';

/** The stored grant token, or null when absent/unreadable/empty. */
export function getDevToken(): string | null {
  try {
    const token = localStorage.getItem(DEV_GRANT_STORAGE_KEY);
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Persist (or clear, when null) the grant token. */
export function setDevToken(token: string | null): void {
  try {
    if (token && token.length > 0) {
      localStorage.setItem(DEV_GRANT_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(DEV_GRANT_STORAGE_KEY);
    }
  } catch {
    /* storage unavailable (private mode) → dev writes simply stay disabled */
  }
}
