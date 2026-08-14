import { requestCache } from "@/lib/request-cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Testers, and the rehearsal switch (Matt, 2026-08-14).
 *
 * Two separate ideas, deliberately:
 *
 *   profiles.tester   WHO is a test account. Real login, real membership,
 *                     real tier, real emails — hidden from every
 *                     member-facing list.
 *   testers_live      WHETHER the app behaves for them as it will on
 *                     October 14: unlaunched features open up, for testers
 *                     only, ahead of the real go-live.
 *
 * Keeping them apart means a tester can be added today and see exactly
 * what a member sees today, and the rehearsal is one switch rather than a
 * per-person state to keep in sync.
 */

export const TESTERS_LIVE_KEY = "testers_live";

/**
 * Is the tester rehearsal on?
 *
 * Fails CLOSED. If the settings read errors we treat the rehearsal as off,
 * because the failure mode of guessing "on" is unlaunched features leaking
 * to whoever happens to be flagged, and the failure mode of guessing "off"
 * is a tester seeing today's app — which is what they'd see anyway.
 */
export const testersLive = requestCache(async (): Promise<boolean> => {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  const { data, error } = await createServiceClient()
    .from("app_settings")
    .select("value")
    .eq("key", TESTERS_LIVE_KEY)
    .maybeSingle();
  if (error || !data) return false;
  const value = data.value as { live?: unknown } | null;
  return value?.live === true;
});

/**
 * The filter every member-facing list applies.
 *
 * Admins see everyone (with testers flagged in the UI); everyone else sees
 * only real members. Written as a helper rather than repeated inline
 * because the leak we're preventing is one query somebody forgot — the
 * directory, the chat roster, search, the member count and the activity
 * feed all have to agree, and a tester who shows up in exactly one of them
 * is worse than not hiding at all: it looks like a bug in the app members
 * are being asked to trust.
 */
export function visibleToMembers<T extends { eq: (col: string, v: unknown) => T }>(
  query: T,
  viewerIsAdmin: boolean,
): T {
  return viewerIsAdmin ? query : query.eq("tester", false);
}

/**
 * Does this person get the post-launch experience?
 *
 * Admins always do — previewing an unlaunched area is how the launch gets
 * checked. Testers do once the rehearsal is on. Nobody else does until the
 * feature itself is launched for everyone.
 */
export function seesLaunchedApp(opts: {
  isAdmin: boolean;
  isTester: boolean;
  rehearsalOn: boolean;
}): boolean {
  return opts.isAdmin || (opts.isTester && opts.rehearsalOn);
}
