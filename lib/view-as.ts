/*
 * "View as" — an admin browsing the portal the way a given tier sees it
 * (any admin since 2026-08-05; the Control Center itself stays Super-only).
 *
 * WHAT THIS IS: a faithful simulation of the *product*. Navigation, padlocks,
 * page guards, upgrade prompts, the Studios and the Admin Panel all behave as
 * they would for the chosen tier, so a launch can be checked before it ships.
 *
 * WHAT THIS IS NOT: a different database identity. Requests still carry the
 * admin's own session, so Postgres still answers as them and RLS-permissive
 * reads stay permissive. This can only ever SHOW LESS than the admin already
 * had — it never grants anything — which is precisely why it is safe to hand
 * to the one account that already holds everything.
 *
 * The cookie is meaningless on its own: every read re-checks that the signer
 * is really a super admin, so a copied cookie in someone else's browser does
 * nothing at all.
 */

import { cookies } from "next/headers";

export const VIEW_AS_COOKIE = "mp_view_as";

/** The raw cookie value, before any authority check. */
export async function readViewAsCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    const value = jar.get(VIEW_AS_COOKIE)?.value?.trim();
    return value ? value : null;
  } catch {
    // Rendered somewhere without a request scope (static generation).
    return null;
  }
}

/*
 * Roles that aren't membership tiers but do change what the portal shows.
 * "Speaker" and "Sponsor" exist as tiers AND as studio flags; viewing as one
 * has to turn the studio on, or the preview is missing the half that matters.
 */
export interface ViewAsState {
  /** The tier slug being simulated. */
  tier: string;
  /** Simulated Speaker Studio access. */
  isSpeaker: boolean;
  /** Simulated Sponsor Studio access. */
  isSponsorManager: boolean;
  /** Simulated admin rights — only when viewing as the admin tier itself. */
  isAdmin: boolean;
}

export function viewAsStateFor(tier: string): ViewAsState {
  return {
    tier,
    isSpeaker: tier === "speaker",
    isSponsorManager: tier === "sponsor",
    isAdmin: tier === "admin",
  };
}
