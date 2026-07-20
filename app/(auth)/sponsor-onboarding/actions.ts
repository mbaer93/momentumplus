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
  /** Long-form "about" text for the sponsor's profile page. */
  description: string;
  website: string;
  offer: string;
  repName: string;
  repTitle: string;
  repPhone: string;
  /** Emails for the tier's free VIP access tickets (whitespace/comma
      separated) — optional; more can be handed out later in the Studio. */
  ticketEmails?: string;
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
  // First AND last name are required before access is granted (applies to
  // members, speakers, and sponsor reps alike).
  if (repName.split(/\s+/).length < 2) {
    return { ok: false, message: "Please enter your first and last name." };
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
  const sponsorRow = {
    name: businessName,
    tier: normalizeSponsorTier(invite.tier),
    tagline: input.tagline.trim() || null,
    description: input.description.trim() || null,
    offer: input.offer.trim() || null,
    website: input.website.trim() || null,
    rail_active: false,
    expires_at: termEnd,
  };
  let { data: sponsor, error: sponsorError } = await admin
    .from("sponsors")
    .insert(sponsorRow)
    .select("id")
    .single();
  if (sponsorError && sponsorError.message.includes("description")) {
    // Pre-migration fallback: the column arrives with 0033.
    const { description: _drop, ...legacy } = sponsorRow;
    ({ data: sponsor, error: sponsorError } = await admin
      .from("sponsors")
      .insert(legacy)
      .select("id")
      .single());
  }
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

  // 3) Owner seat + sponsor-tier access (Pro-equivalent) through October 1.
  // The rep who completes onboarding is the page's primary manager.
  const { error: seatError } = await admin
    .from("sponsor_members")
    .upsert(
      { sponsor_id: sponsor.id, profile_id: user.id, role: "owner" },
      { onConflict: "sponsor_id,profile_id" },
    );
  if (seatError && /role/.test(seatError.message)) {
    // Pre-migration-0039 fallback: seat without a role column.
    await admin
      .from("sponsor_members")
      .upsert(
        { sponsor_id: sponsor.id, profile_id: user.id },
        { onConflict: "sponsor_id,profile_id" },
      );
  }
  const { upsertSponsorMembership } = await import("@/lib/sponsor-membership");
  const access = await upsertSponsorMembership(user.id, termEnd, true);
  if (access.error) {
    // Leave the invite open so the rep can retry — without a membership row
    // they'd be locked out of the portal.
    return {
      ok: false,
      message: `Your sponsor page saved, but portal access couldn't be set up: ${access.error}. Please try again or contact the Momentum+ team.`,
    };
  }

  // 4) Close out the invite.
  await admin
    .from("sponsor_invites")
    .update({ completed_at: new Date().toISOString(), sponsor_id: sponsor.id })
    .eq("id", invite.id);

  // 5) VIP access tickets, if the rep listed emails. Best-effort — a bad
  //    email must not sink the onboarding that already succeeded; the
  //    Studio shows remaining tickets and per-person status afterwards.
  let ticketNote = "";
  const ticketEmails = (input.ticketEmails ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (ticketEmails.length > 0) {
    try {
      const { inviteTicketUsers } = await import("@/lib/sponsor-team");
      const summary = await inviteTicketUsers(
        { id: sponsor.id as string },
        ticketEmails,
      );
      const bits: string[] = [];
      if (summary.invited.length > 0) {
        bits.push(`${summary.invited.length} VIP invite${summary.invited.length === 1 ? "" : "s"} sent`);
      }
      for (const f of summary.failed) bits.push(`${f.email}: ${f.reason}`);
      ticketNote = bits.join("; ");
    } catch {
      ticketNote =
        "Your VIP invites couldn't be sent just now — hand them out from your Sponsor Studio.";
    }
  }

  revalidatePath("/sponsors");
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  return { ok: true, sponsorId: sponsor.id, message: ticketNote || undefined };
}

/** Whether the signed-in user has a pending sponsor invite (drives the
    onboarding page's render). */
export async function getPendingSponsorInvite(): Promise<{
  pending: boolean;
  tier?: string;
  businessName?: string;
  needsPassword?: boolean;
  /** Free VIP access tickets included with the invited tier. */
  ticketAllotment?: number;
}> {
  if (!isSupabaseConfigured()) {
    return {
      pending: true,
      tier: "partner",
      businessName: "",
      needsPassword: true,
      ticketAllotment: 2,
    };
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
  const { getTicketCounts } = await import("@/lib/sponsor-team");
  const counts = await getTicketCounts();
  return {
    pending: true,
    tier: invite.tier as string,
    businessName: (invite.business_name as string) ?? "",
    needsPassword: Boolean(invite.account_created),
    ticketAllotment: counts[normalizeSponsorTier(invite.tier as string)] ?? 0,
  };
}
