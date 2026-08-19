import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requestCache } from "@/lib/request-cache";
import {
  isSupabaseConfigured,
  suppressInsecureUserWarning,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "./config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Server Supabase client for Server Components, Route Handlers, and Server
// Actions. Uses the request cookie store for the authenticated session.
// `cookies()` is async as of Next 15, so this is too — callers await it.

/*
 * About the "Using the user object as returned from supabase.auth.getSession()
 * … could be insecure!" warning filling the Vercel logs (investigated
 * 2026-08-19). It is a known upstream false positive. Do not act on it, and
 * do not upgrade @supabase/ssr expecting it to stop.
 *
 * What it is: auth-js wraps session.user in a Proxy on the server that logs on
 * any property read. Supabase's server storage adapter keeps the session as
 * stringified JSON, and JSON.stringify() touches every property — including
 * .user — so _useSession() trips the proxy on its own. getUser() then sets
 * suppressGetSessionWarning AFTER it returns (GoTrueClient ~2637), so the
 * first call of each request warns no matter what the caller did.
 * getAuthenticatorAssuranceLevel() trips it the same way, which is why the
 * volume rose when two-factor landed.
 *
 * Why it does not apply to us: there is no getSession() call anywhere in this
 * codebase. Every authorization decision — middleware, getAuthUser below,
 * requireAdmin, requireRealAdmin, every route and action — goes through
 * auth.getUser(), which round-trips to the Auth server and validates the JWT
 * instead of trusting the cookie. That IS the thing the warning asks for.
 *
 * Why upgrading does not help: @supabase/ssr never calls getSession() at all
 * (grep its dist — no hits). The proxy lives in @supabase/auth-js, which is
 * already current at 2.110.5, and that repo was archived read-only in Jan
 * 2026. There is no version of ssr that removes this.
 *
 * If it needs to go away, filter it in Vercel's log view. If a future upgrade
 * silences it, delete this comment.
 *
 *   https://github.com/supabase/auth-js/issues/873
 *   https://github.com/supabase/auth-js/issues/910
 */
/** Per-request cached auth lookup. auth.getUser() round-trips to Supabase
    Auth to validate the JWT — one page render used to repeat it 3-5×
    (audit P2-15). Cached per RSC render; server actions get a fresh call. */
export const getAuthUser = requestCache(async () => {
  /*
   * Preview mode has no credentials, and createServerClient THROWS on an
   * empty URL rather than returning a client that fails politely. Every
   * caller that reads the user without first checking isSupabaseConfigured()
   * therefore blew up the whole page — /profile has been rendering
   * "Something hiccuped" in preview, which is also why the contrast audit
   * scored it a clean 0: it was auditing an error page (found 2026-08-18).
   *
   * Nobody is signed in when there is no auth to sign into, so null is the
   * honest answer and every existing `if (!user)` branch already handles it.
   */
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function createClient() {
  const cookieStore = await cookies();

  const client = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if middleware refreshes the session.
        }
      },
    },
  });

  suppressInsecureUserWarning(client.auth);
  return client;
}
