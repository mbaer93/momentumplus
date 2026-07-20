import { redirect } from "next/navigation";
import { tierLabel } from "./access";
import { effectiveMembership } from "./membership";
import { initials, placeholderProfile } from "./placeholder-data";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { Membership, Tier } from "./types";
import { requestCache } from "@/lib/request-cache";

/*
 * Summit-companion twin of the portal's current-member resolver, against the
 * same shared database. Differences: no /welcome onboarding detour (an
 * attendee opening the app at the venue door should never be blocked on a
 * profile form), and lapsed members land on this app's own /expired screen.
 */

export interface CurrentMember {
  name: string;
  email: string;
  initials: string;
  tier: Tier;
  tierLabel: string;
  isAdmin: boolean;
  adminTitle: string | null;
  membershipActive: boolean;
  accessExpiresAt: string | null;
}

export async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.membershipActive) redirect("/expired");
  return member;
}

export const getCurrentMember = requestCache(
  async (): Promise<CurrentMember | null> => {
    if (!isSupabaseConfigured()) {
      const tier = placeholderProfile.tier;
      return {
        name: placeholderProfile.full_name,
        email: placeholderProfile.email,
        initials: initials(placeholderProfile.full_name),
        tier,
        tierLabel: tierLabel(tier),
        isAdmin: tier === "admin",
        adminTitle: tier === "admin" ? "TSLS Team" : null,
        membershipActive: true,
        accessExpiresAt: null,
      };
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const [{ data: profile }, { data: memberships }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, admin_title")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("memberships")
        .select("tier, status, access_starts_at, access_expires_at")
        .eq("profile_id", user.id),
    ]);

    const name = profile?.full_name || user.email || "Member";
    const rows = (memberships ?? []) as Pick<
      Membership,
      "tier" | "status" | "access_starts_at" | "access_expires_at"
    >[];
    const effective = effectiveMembership(rows);

    return {
      name,
      email: profile?.email ?? user.email ?? "",
      initials: initials(name),
      tier: effective?.tier ?? "tsls_attendee",
      tierLabel: effective ? tierLabel(effective.tier) : "Membership lapsed",
      isAdmin: effective?.tier === "admin",
      adminTitle:
        effective?.tier === "admin" ? (profile?.admin_title ?? null) : null,
      membershipActive: effective !== null,
      accessExpiresAt: effective?.access_expires_at ?? null,
    };
  },
);
