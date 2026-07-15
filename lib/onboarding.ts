import { addMonths } from "@/lib/membership";
import { createServiceClient } from "@/lib/supabase/admin";
import type { Tier } from "@/lib/types";

/*
 * Shared member provisioning used by the Zapier webhook, the admin bulk
 * importer, and (pattern-wise) the TSLS sheet import:
 *   email → invite via Supabase (magic-link email → /welcome to set a
 *   password) or find the existing profile → upsert profile name →
 *   insert membership (skipping exact duplicates so retries are safe).
 */

export interface ProvisionInput {
  email: string;
  name?: string;
  tier: Tier;
  /** Access length; 0/null = ongoing (speaker/admin-style grants). */
  months: number | null;
  source: string;
}

export interface ProvisionResult {
  ok: boolean;
  email: string;
  /** A brand-new account was created and an invite email sent. */
  invited: boolean;
  /** An equivalent active membership already existed; nothing inserted. */
  alreadyActive: boolean;
  message?: string;
}

/**
 * Friendly plan names (Zapier fields, CSV columns) → tier + months.
 * Mirrors the confirmed pricing plans plus TSLS registration tiers.
 */
export function planToTier(plan: string): { tier: Tier; months: number } | null {
  const p = plan.trim().toLowerCase().replace(/[\s_\-+]/g, "");
  switch (p) {
    case "monthly":
    case "submonthly":
    case "1month":
    case "month":
      return { tier: "sub_monthly", months: 1 };
    case "3month":
    case "3months":
    case "3mo":
    case "sub3mo":
    case "quarterly":
      return { tier: "sub_3mo", months: 3 };
    case "6month":
    case "6months":
    case "6mo":
    case "sub6mo":
      return { tier: "sub_6mo", months: 6 };
    case "12month":
    case "12months":
    case "12mo":
    case "annual":
    case "subannual":
    case "yearly":
    case "1year":
      return { tier: "sub_annual", months: 12 };
    case "attendee":
    case "tslsattendee":
      return { tier: "tsls_attendee", months: 12 };
    case "vip":
    case "tslsvip":
      return { tier: "tsls_vip", months: 12 };
    case "speaker":
      return { tier: "speaker", months: 0 };
    default:
      return null;
  }
}

export async function provisionMember(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const base: Omit<ProvisionResult, "ok" | "message"> = {
    email,
    invited: false,
    alreadyActive: false,
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ...base, ok: false, message: "Not a valid email address." };
  }

  const admin = createServiceClient();
  let profileId: string | null = null;
  let invited = false;

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (profile) {
    profileId = profile.id;
  } else {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: input.name ?? "" },
      redirectTo: siteUrl ? `${siteUrl}/auth/callback?redirect=/welcome` : undefined,
    });
    if (inv?.user) {
      profileId = inv.user.id;
      invited = true;
    } else if (error) {
      // Auth user may exist without a profile row yet (invite race) — retry.
      const { data: again } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      profileId = again?.id ?? null;
    }
  }
  if (!profileId) {
    return { ...base, ok: false, message: "Could not invite or find this email." };
  }

  // Signup trigger races the invite; upsert keeps the name.
  await admin.from("profiles").upsert(
    {
      id: profileId,
      email,
      ...(input.name?.trim() ? { full_name: input.name.trim() } : {}),
    },
    { onConflict: "id" },
  );

  // Idempotency: an active membership of the same tier that hasn't expired
  // means a retried Zapier task / re-pasted CSV row shouldn't double-grant.
  const { data: existing } = await admin
    .from("memberships")
    .select("id, access_expires_at")
    .eq("profile_id", profileId)
    .eq("tier", input.tier)
    .eq("status", "active");
  const stillActive = (existing ?? []).some(
    (m) => !m.access_expires_at || new Date(m.access_expires_at) > new Date(),
  );
  if (stillActive) {
    return {
      ...base,
      ok: true,
      invited,
      alreadyActive: true,
      message: `${email}: already has an active ${input.tier} membership.`,
    };
  }

  const now = new Date();
  const months = input.months ?? 0;
  const { error: memberError } = await admin.from("memberships").insert({
    profile_id: profileId,
    tier: input.tier,
    status: "active",
    access_starts_at: now.toISOString(),
    access_expires_at:
      months > 0 ? addMonths(now, months).toISOString() : null,
    source: input.source,
  });
  if (memberError) {
    return { ...base, ok: false, invited, message: memberError.message };
  }

  return {
    ...base,
    ok: true,
    invited,
    message: invited
      ? `${email}: invited + ${input.tier} granted.`
      : `${email}: ${input.tier} granted (existing account).`,
  };
}
