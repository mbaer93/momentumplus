"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { seasonEnd } from "@/lib/sponsor-lifecycle";
import { normalizeSponsorTier } from "@/lib/sponsor-tiers";

/*
 * Completion of a sponsor invite: the signed-in rep submits their business
 * details + their own info. Creates the sponsor (term through October 1),
 * seats the rep, and grants them Pro access to the same date. The invite
 * row (service-role only) is the authorization: no pending invite for this
 * account, no sponsor creation.
 */

export interface SponsorOnboardingInput {
  businessName: string;
  tagline: string;
  website: string;
  offer: string;
  repName: string;
  repTitle: string;
  repPhone: string;
}

export interface SponsorOnboardingResult {
  ok: boolean;
  message?: string;
  sponsorId?: string;
}

export async function completeSponsorOnboarding(
  input: SponsorOnboardingInput,
): Promise<SponsorOnboardingResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in first." };

  const businessName = input.businessName.trim();
  const repName = input.repName.trim();
  if (!businessName) {
    return { ok: false, message: "Tell us the business name." };
  }
  if (!repName) {
    return { ok: false, message: "Tell us your name." };
  }

  const admin = createServiceClient();
  const { data: invite } = await admin
    .from("sponsor_invites")
    .select("id, tier, email")
    .eq("invited_profile_id", user.id)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invite) {
    return {
      ok: false,
      message:
        "We couldn't find a pending sponsor invite for this account — ask the Momentum+ team to re-send yours.",
    };
  }

  const termEnd = seasonEnd().toISOString();

  // 1) The sponsor page entry (hidden from the rail until the team
  //    activates it; tier was chosen by the admin at invite time).
  const { data: sponsor, error: sponsorError } = await admin
    .from("sponsors")
    .insert({
      name: businessName,
      tier: normalizeSponsorTier(invite.tier),
      tagline: input.tagline.trim() || null,
      offer: input.offer.trim() || null,
      website: input.website.trim() || null,
      rail_active: false,
      expires_at: termEnd,
    })
    .select("id")
    .single();
  if (sponsorError || !sponsor) {
    return {
      ok: false,
      message: sponsorError?.message ?? "Couldn't save the business.",
    };
  }

  // 2) The rep's profile details.
  await admin
    .from("profiles")
    .update({
      full_name: repName,
      title: input.repTitle.trim() || null,
      phone: input.repPhone.trim() || null,
      company: businessName,
    })
    .eq("id", user.id);

  // 3) Seat + Pro access through October 1.
  await admin
    .from("sponsor_members")
    .upsert(
      { sponsor_id: sponsor.id, profile_id: user.id },
      { onConflict: "sponsor_id,profile_id" },
    );
  const { data: existingPro } = await admin
    .from("memberships")
    .select("id")
    .eq("profile_id", user.id)
    .eq("tier", "pro")
    .eq("source", "sponsor")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingPro) {
    await admin
      .from("memberships")
      .update({ status: "active", access_expires_at: termEnd })
      .eq("id", existingPro.id);
  } else {
    await admin.from("memberships").insert({
      profile_id: user.id,
      tier: "pro",
      status: "active",
      access_starts_at: new Date().toISOString(),
      access_expires_at: termEnd,
      source: "sponsor",
    });
  }

  // 4) Close out the invite.
  await admin
    .from("sponsor_invites")
    .update({ completed_at: new Date().toISOString(), sponsor_id: sponsor.id })
    .eq("id", invite.id);

  revalidatePath("/sponsors");
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  return { ok: true, sponsorId: sponsor.id };
}

/** Whether the signed-in user has a pending sponsor invite (drives the
    onboarding page's render). */
export async function getPendingSponsorInvite(): Promise<{
  pending: boolean;
  tier?: string;
  businessName?: string;
  needsPassword?: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { pending: true, tier: "partner", businessName: "", needsPassword: true };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { pending: false };
  const { data: invite } = await createServiceClient()
    .from("sponsor_invites")
    .select("tier, business_name, account_created")
    .eq("invited_profile_id", user.id)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invite) return { pending: false };
  return {
    pending: true,
    tier: invite.tier as string,
    businessName: (invite.business_name as string) ?? "",
    needsPassword: Boolean(invite.account_created),
  };
}
