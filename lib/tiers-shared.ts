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
