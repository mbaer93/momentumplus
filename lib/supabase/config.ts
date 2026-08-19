// Central place to read Supabase env. During Phase 1 the app is runnable
// without live credentials: when they are absent, auth is bypassed in dev so
// the portal shell + placeholder data can be viewed (see middleware.ts).

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Silence auth-js's "getSession() could be insecure" warning on server
 * clients (Matt, 2026-08-19 — "filter the warning in Vercel logs").
 *
 * It fired on essentially every authenticated request and made the log
 * unreadable. Filtering it in Vercel's UI would mean hiding the whole
 * Warning level, which throws away the real ones too — so it is switched
 * off at the source instead.
 *
 * WHY THIS IS SAFE HERE, and only here: the warning tells you not to trust
 * `getSession().user` for authorization. This codebase never calls
 * getSession() at all — every gate goes through `auth.getUser()`, which
 * validates the JWT against the Auth server. `tests/supabase-auth.test.ts`
 * asserts that invariant in CI, so this flag can never end up hiding a real
 * misuse: add a getSession() call and the build fails.
 *
 * The flag is the same one auth-js sets itself once getUser() succeeds
 * (GoTrueClient ~2637) — this only sets it up front, because the warning
 * fires from _useSession() BEFORE that assignment lands. It is `protected`
 * in the published types, hence the cast. If a future version renames it
 * the suppression stops working and the noise returns; nothing breaks and
 * nothing becomes less safe.
 *
 * Server clients only. The proxy that emits it is installed when
 * `storage.isServer`, so browser clients never trip it.
 */
export function suppressInsecureUserWarning(auth: unknown): void {
  try {
    (auth as { suppressGetSessionWarning?: boolean }).suppressGetSessionWarning =
      true;
  } catch {
    // A future version could make it a getter with no setter. Log noise is
    // not worth throwing on a request for.
  }
}
