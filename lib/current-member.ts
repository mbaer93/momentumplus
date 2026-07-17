import { redirect } from "next/navigation";
import { tierLabel } from "./access";
import { effectiveMembership } from "./membership";
import { initials, placeholderProfile } from "./placeholder-data";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { Membership, Tier } from "./types";
import { requestCache } from "@/lib/request-cache";

export interface CurrentMember {
  name: string;
  email: string;
  initials: string;
  tier: Tier;
  tierLabel: string;
  isAdmin: boolean;
  /** Admin-set title (relative to Momentum+/TSLS) shown on their chat messages. */
  adminTitle: string | null;
  /** False when every membership has lapsed → portal layout sends to /expired. */
  membershipActive: boolean;
  accessExpiresAt: string | null;
}

/**
 * Resolve the member rendered in the portal shell.
 *
 * With Supabase configured this reads the real profile + memberships and picks
 * the most privileged row that still grants access (grace semantics included).
 * Returns null when nobody is signed in (middleware normally prevents this).
 * In preview mode (no Supabase env) it returns the placeholder member.
 */
/**
 * Portal-page guard: signed-in member with an active membership, or redirect
 * (login when signed out, /expired when the membership lapsed — SPEC.md §5).
 */
export async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.membershipActive) redirect("/expired");
  return member;
}

/*
 * requestCache(): the portal layout and nearly every page resolve the member
 * independently — this dedupes them to one auth call + one query pair per
 * request instead of one per call site.
 */
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
      adminTitle: tier === "admin" ? "Momentum+ Team" : null,
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
});
