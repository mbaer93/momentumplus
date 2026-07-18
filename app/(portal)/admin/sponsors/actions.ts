"use server";

import { emailPattern } from "@/lib/db-utils";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { provisionMember } from "@/lib/onboarding";
import { PRESENTED_BY_PATH } from "@/lib/presented-by";
import { seasonEnd } from "@/lib/sponsor-lifecycle";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface SponsorInput {
  name: string;
  tier: import("@/lib/sponsor-tiers").SponsorTier;
  tagline: string;
  /** Long-form "about" text on the sponsor's profile page. */
  description: string;
  offer: string;
  website: string;
  railActive: boolean;
}

export interface SponsorResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

/** Per-tier VIP ticket allotments (Admin → Sponsors). */
export async function saveSponsorTicketCounts(
  counts: Record<string, number>,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };
  const { saveTicketCounts } = await import("@/lib/sponsor-team");
  const { error } = await saveTicketCounts(counts);
  if (error) return { ok: false, message: error };
  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsor");
  return { ok: true, message: "Ticket allotments saved." };
}

/** Per-sponsor ticket override: a custom count that replaces the tier
    default for one sponsor. null = back to the tier default. */
export async function saveSponsorTicketOverride(
  sponsorId: string,
  override: number | null,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };
  const value =
    override === null || !Number.isFinite(override) || override < 0
      ? null
      : Math.floor(override);
  const { error } = await createServiceClient()
    .from("sponsors")
    .update({ ticket_override: value })
    .eq("id", sponsorId);
  if (error) {
    return {
      ok: false,
      message: /ticket_override/.test(error.message)
        ? "Run migration 0041 in the Supabase SQL editor first — it adds the override column."
        : error.message,
    };
  }
  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsor");
  return {
    ok: true,
    message:
      value === null
        ? "Override cleared — this sponsor uses the tier default again."
        : `This sponsor now has ${value} VIP ticket${value === 1 ? "" : "s"} regardless of tier.`,
  };
}

export async function createSponsor(input: SponsorInput): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Created (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const row = {
    name: input.name.trim(),
    tier: (await import("@/lib/sponsor-tiers")).normalizeSponsorTier(input.tier),
    tagline: input.tagline.trim() || null,
    description: input.description.trim() || null,
    offer: input.offer.trim() || null,
    website: input.website.trim() || null,
    rail_active: input.railActive,
  };
  let { error } = await admin.from("sponsors").insert(row);
  if (error && error.message.includes("description")) {
    // Pre-migration fallback: the column arrives with 0033.
    const { description: _drop, ...legacy } = row;
    ({ error } = await admin.from("sponsors").insert(legacy));
  }
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/sponsors");
  revalidateTag("sponsors");
  return { ok: true, message: "Sponsor created." };
}

export async function toggleRail(
  sponsorId: string,
  railActive: boolean,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Toggled (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsors")
    .update({ rail_active: railActive })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  return { ok: true };
}

/**
 * Expire sponsor-comped Pro memberships for profiles that no longer hold a
 * seat with ANY sponsor ("Pro for as long as they are a sponsor").
 */
async function expireOrphanedSponsorPro(profileIds: string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const admin = createServiceClient();
  const { data: stillSeated } = await admin
    .from("sponsor_members")
    .select("profile_id")
    .in("profile_id", profileIds);
  const seated = new Set((stillSeated ?? []).map((r) => r.profile_id));
  const orphaned = profileIds.filter((id) => !seated.has(id));
  if (orphaned.length === 0) return;
  // Source (not tier) marks sponsor-granted rows — catches both comped-Pro
  // seats and the rep's sponsor-tier row.
  await admin
    .from("memberships")
    .update({ status: "expired", access_expires_at: new Date().toISOString() })
    .in("profile_id", orphaned)
    .eq("source", "sponsor")
    .eq("status", "active");
}

export async function deleteSponsor(sponsorId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data: seats } = await admin
    .from("sponsor_members")
    .select("profile_id")
    .eq("sponsor_id", sponsorId);
  const { error } = await admin.from("sponsors").delete().eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  await expireOrphanedSponsorPro((seats ?? []).map((s) => s.profile_id));
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/sponsors");
  revalidateTag("sponsors");
  return { ok: true, message: "Sponsor deleted." };
}

/**
 * Attach a member to a sponsor. They get (or keep) an ongoing Pro membership
 * for as long as they hold a seat with at least one sponsor. New emails are
 * invited through the normal first-login flow. Seat counts per sponsorship
 * tier aren't enforced yet — those rules are still being decided.
 */
export async function linkSponsorMember(
  sponsorId: string,
  email: string,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Linked (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const res = await provisionMember({
    email,
    tier: "pro",
    months: null, // ongoing — revoked when their last sponsor seat is removed
    source: "sponsor",
  });
  if (!res.ok) return { ok: false, message: res.message };

  const admin = createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", emailPattern(email))
    .maybeSingle();
  if (!profile) return { ok: false, message: "Could not find that member." };

  const { error } = await admin
    .from("sponsor_members")
    .upsert(
      { sponsor_id: sponsorId, profile_id: profile.id },
      { onConflict: "sponsor_id,profile_id" },
    );
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  return {
    ok: true,
    message: res.invited
      ? `${email} invited and linked — they hold Pro while sponsoring.`
      : `${email} linked — they hold Pro while sponsoring.`,
  };
}

export async function unlinkSponsorMember(
  sponsorId: string,
  profileId: string,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Unlinked (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsor_members")
    .delete()
    .eq("sponsor_id", sponsorId)
    .eq("profile_id", profileId);
  if (error) return { ok: false, message: error.message };
  await expireOrphanedSponsorPro([profileId]);

  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  return { ok: true, message: "Member unlinked — sponsor Pro access ended." };
}

export async function updateSponsor(
  sponsorId: string,
  input: SponsorInput,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const row = {
    name: input.name.trim(),
    tier: (await import("@/lib/sponsor-tiers")).normalizeSponsorTier(input.tier),
    tagline: input.tagline.trim() || null,
    description: input.description.trim() || null,
    offer: input.offer.trim() || null,
    website: input.website.trim() || null,
    rail_active: input.railActive,
  };
  let { error } = await admin.from("sponsors").update(row).eq("id", sponsorId);
  if (error && error.message.includes("description")) {
    // Pre-migration fallback: the column arrives with 0033.
    const { description: _drop, ...legacy } = row;
    ({ error } = await admin.from("sponsors").update(legacy).eq("id", sponsorId));
  }
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/sponsors");
  revalidateTag("sponsors");
  return { ok: true, message: "Sponsor saved." };
}

/**
 * Upload a sponsor graphic to the public sponsor-logos bucket and store its
 * URL on the sponsor row. Two kinds: the logo (profile/cards) and the sidebar
 * ad creative (left-panel slot). FormData: { file: File }. PNG/JPG/SVG/WebP
 * up to 2 MB.
 */
async function uploadSponsorImage(
  sponsorId: string,
  formData: FormData,
  kind: "logo" | "sidebar_ad",
): Promise<SponsorResult> {
  const label = kind === "logo" ? "Logo" : "Ad graphic";
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Uploaded (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "No file received — choose an image and try the upload again.",
    };
  }
  if (file.size > 2 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `${label} is ${mb} MB — the limit is 2 MB. Compress or resize the image and try again.`,
    };
  }
  const allowed: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  const ext = allowed[file.type];
  if (!ext) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — upload a PNG, JPG, SVG, or WebP instead.`,
    };
  }

  const admin = createServiceClient();
  const path =
    kind === "logo" ? `${sponsorId}.${ext}` : `${sponsorId}-ad.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("sponsor-logos")
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };

  const { data: pub } = admin.storage.from("sponsor-logos").getPublicUrl(path);
  // Cache-bust so a replaced graphic shows immediately.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error } = await admin
    .from("sponsors")
    .update(kind === "logo" ? { logo_url: url } : { sidebar_ad_url: url })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/sponsors");
  revalidateTag("sponsors");
  revalidatePath("/", "layout");
  return { ok: true, message: `${label} uploaded.` };
}

export async function uploadSponsorLogo(
  sponsorId: string,
  formData: FormData,
): Promise<SponsorResult> {
  return uploadSponsorImage(sponsorId, formData, "logo");
}

export async function uploadSponsorAd(
  sponsorId: string,
  formData: FormData,
): Promise<SponsorResult> {
  return uploadSponsorImage(sponsorId, formData, "sidebar_ad");
}

/**
 * Upload the site-wide "Presented by" logo (left panel). One slot — it
 * belongs to the current Momentum+ Sponsor and is replaced when a new
 * sponsor takes over. Stored at a fixed bucket path, no sponsor row needed.
 */
export async function uploadPresentedByLogo(
  formData: FormData,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Uploaded (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "No file received — choose an image and try the upload again.",
    };
  }
  if (file.size > 2 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `Presented-by logo is ${mb} MB — the limit is 2 MB. Compress or resize the image and try again.`,
    };
  }
  const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — upload a PNG, JPG, SVG, or WebP instead.`,
    };
  }

  const admin = createServiceClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from("sponsor-logos")
    .upload(PRESENTED_BY_PATH, bytes, { contentType: file.type, upsert: true });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/", "layout");
  return { ok: true, message: "Presented-by logo uploaded." };
}

/** Remove the presented-by logo (the slot falls back to the sponsor's regular logo/name). */
export async function removePresentedByLogo(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Removed (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.storage
    .from("sponsor-logos")
    .remove([PRESENTED_BY_PATH]);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/", "layout");
  return { ok: true, message: "Presented-by logo removed." };
}

/** Remove the ad creative (the rail card falls back to the logo layout). */
export async function removeSponsorAd(sponsorId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Removed (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsors")
    .update({ sidebar_ad_url: null })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  revalidatePath("/", "layout");
  return { ok: true, message: "Ad graphic removed." };
}


/* =====================================================================
   Sponsor lifecycle (Matt, 2026-07-17): invite a sponsor rep by email;
   they self-serve the business + personal details at /sponsor-onboarding.
   Sponsorships and rep Pro access run through October 1; archived/expired
   sponsors are hidden from members (never deleted) and reinstatable.
   ===================================================================== */

export interface SponsorInviteResult extends SponsorResult {
  /** Manual sign-in link when the invite email could not be sent. */
  loginLink?: string | null;
}

export async function inviteSponsorRep(
  emailRaw: string,
  tierRaw: string,
  businessName: string,
): Promise<SponsorInviteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Invite sent (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "That doesn't look like a valid email." };
  }
  const { normalizeSponsorTier } = await import("@/lib/sponsor-tiers");
  const tier = normalizeSponsorTier(tierRaw);

  const admin = createServiceClient();

  // One pending invite per email: refresh it instead of stacking.
  const { data: pending } = await admin
    .from("sponsor_invites")
    .select("id")
    .ilike("email", emailPattern(email))
    .is("completed_at", null)
    .maybeSingle();

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", emailPattern(email))
    .maybeSingle();

  let profileId: string | null = profile?.id ?? null;
  let accountCreated = false;
  let invited = false;
  let loginLink: string | null = null;

  if (!profileId) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const { data: inv } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=/sponsor-onboarding`
        : undefined,
    });
    if (inv?.user) {
      profileId = inv.user.id;
      invited = true;
      accountCreated = true;
    } else {
      const { findAuthUserIdByEmail, createAccountWithoutEmail } =
        await import("@/lib/onboarding");
      profileId = await findAuthUserIdByEmail(email);
      if (!profileId) {
        const created = await createAccountWithoutEmail(email);
        profileId = created.profileId;
        loginLink = created.loginLink ?? null;
        accountCreated = true;
      }
    }
  }
  if (!profileId) {
    return { ok: false, message: "Couldn't create an account for that email." };
  }

  const inviteRow = {
    email,
    tier,
    business_name: businessName.trim() || null,
    invited_profile_id: profileId,
    account_created: accountCreated,
    created_by: auth.userId,
    completed_at: null,
  };
  const { error } = pending
    ? await admin.from("sponsor_invites").update(inviteRow).eq("id", pending.id)
    : await admin.from("sponsor_invites").insert(inviteRow);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  return {
    ok: true,
    loginLink,
    message: invited
      ? `Invite sent to ${email} — the email walks them through adding their business and their own details.`
      : loginLink
        ? `Account created but the invite email failed to send — copy the sign-in link below and send it to ${email} yourself.`
        : `${email} already has a Momentum+ account — they'll see the sponsor setup form at momentumplus.co/sponsor-onboarding the next time they sign in (send them that link).`,
  };
}

/** Retire a sponsor into the admin-only Past Sponsors archive. */
export async function archiveSponsor(sponsorId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Archived (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsors")
    .update({ archived_at: new Date().toISOString(), rail_active: false })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  // End the reps' sponsor-comp Pro access now (unless another ACTIVE
  // sponsor still seats them).
  const { data: seats } = await admin
    .from("sponsor_members")
    .select("profile_id")
    .eq("sponsor_id", sponsorId);
  const repIds = (seats ?? []).map((r) => r.profile_id as string);
  if (repIds.length > 0) {
    const { data: otherSeats } = await admin
      .from("sponsor_members")
      .select("profile_id, sponsors!inner ( archived_at, expires_at )")
      .in("profile_id", repIds)
      .neq("sponsor_id", sponsorId);
    const stillActive = new Set(
      (otherSeats ?? [])
        .filter((r) => {
          const sp = r.sponsors as unknown as {
            archived_at: string | null;
            expires_at: string | null;
          };
          return (
            !sp.archived_at &&
            (!sp.expires_at || new Date(sp.expires_at) > new Date())
          );
        })
        .map((r) => r.profile_id as string),
    );
    const toExpire = repIds.filter((id) => !stillActive.has(id));
    if (toExpire.length > 0) {
      await admin
        .from("memberships")
        .update({
          status: "expired",
          access_expires_at: new Date().toISOString(),
        })
        .in("profile_id", toExpire)
        .eq("source", "sponsor")
        .eq("status", "active");
    }
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  return {
    ok: true,
    message:
      "Moved to Past Sponsors — hidden from members, reps' sponsor access ended. Reinstate anytime.",
  };
}

/** Bring a past sponsor back: visible again, term through next October 1,
    reps' Pro access restored to the same date. */
export async function reinstateSponsor(
  sponsorId: string,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Reinstated (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const termEnd = seasonEnd().toISOString();
  const { error } = await admin
    .from("sponsors")
    .update({ archived_at: null, expires_at: termEnd })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  // Restore each seat's sponsor-granted access through the new term. The
  // rep (whoever completed the sponsor invite) holds the sponsor tier;
  // comped seat members stay Pro.
  const { upsertSponsorMembership } = await import("@/lib/sponsor-membership");
  const [{ data: seats }, { data: repInvites }] = await Promise.all([
    admin
      .from("sponsor_members")
      .select("profile_id")
      .eq("sponsor_id", sponsorId),
    admin
      .from("sponsor_invites")
      .select("invited_profile_id")
      .eq("sponsor_id", sponsorId)
      .not("completed_at", "is", null),
  ]);
  const reps = new Set(
    (repInvites ?? []).map((r) => r.invited_profile_id as string),
  );
  for (const seat of seats ?? []) {
    const id = seat.profile_id as string;
    await upsertSponsorMembership(id, termEnd, reps.has(id));
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
  return {
    ok: true,
    message: `Reinstated through ${new Date(termEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} — visible to members again, reps' Pro access restored.`,
  };
}
