/*
 * Client-safe tier facts. Split from lib/tiers.ts for the same reason as
 * lib/ads-shared.ts: that module reaches for the server-side Supabase client,
 * and the Control Center is a client component.
 */

/*
 * Tiers that are GRANTED, never sold. Admin is internal staff, speaker comes
 * with a speaking slot, sponsor comes with a sponsorship. "On sale to the
 * public" has no meaning for any of them, so the Go Live switch refuses them
 * outright — an Administrator card appearing in a pricing grid is not a state
 * this product should be able to reach, even by accident (Matt, 2026-07-28).
 */
export const INTERNAL_TIERS = new Set(["admin", "speaker", "sponsor"]);

export function isInternalTier(slug: string): boolean {
  return INTERNAL_TIERS.has(slug);
}

/*
 * Does the target tier open content the current tier can't reach?
 *
 * Decides when a paid subscription bought by a member with unexpired
 * comped/free access starts billing (Matt, 2026-07-28): a sideways move
 * (Summit Attendee buying Member — same content either way) waits for the
 * free access to run out; a real upgrade (buying Pro) charges now, because
 * the extra content unlocks now.
 */
const SCOPE_RANK: Record<string, number> = {
  none: 0,
  current_season: 1,
  all_seasons: 2,
};

export interface ContentAccess {
  libraryScope: string;
  clearsProOnly: boolean;
  clearsVipPlus: boolean;
}

export function grantsMoreContent(
  target: ContentAccess,
  current: ContentAccess,
): boolean {
  return (
    (SCOPE_RANK[target.libraryScope] ?? 0) >
      (SCOPE_RANK[current.libraryScope] ?? 0) ||
    (target.clearsProOnly && !current.clearsProOnly) ||
    (target.clearsVipPlus && !current.clearsVipPlus)
  );
}
