import { tierLabel } from "./access";
import { initials, placeholderProfile } from "./placeholder-data";
import type { Tier } from "./types";

export interface CurrentMember {
  name: string;
  email: string;
  initials: string;
  tier: Tier;
  tierLabel: string;
  isAdmin: boolean;
}

/*
 * Resolves the member rendered in the portal shell.
 *
 * Phase 1: returns placeholder data (SPEC.md — "use placeholder data where the
 * backend isn't built yet"). In Phase 3 this reads the authenticated user's
 * profile + membership from Supabase (createClient().auth.getUser() →
 * profiles/memberships) so tier gating and the sidebar reflect the real member.
 */
export async function getCurrentMember(): Promise<CurrentMember> {
  const tier = placeholderProfile.tier;
  return {
    name: placeholderProfile.full_name,
    email: placeholderProfile.email,
    initials: initials(placeholderProfile.full_name),
    tier,
    tierLabel: tierLabel(tier),
    isAdmin: tier === "admin",
  };
}
