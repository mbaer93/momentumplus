import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requestCache } from "@/lib/request-cache";
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Server Supabase client for Server Components, Route Handlers, and Server
// Actions. Uses the request cookie store for the authenticated session.
// `cookies()` is async as of Next 15, so this is too — callers await it.
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

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
}
