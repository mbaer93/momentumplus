"use server";

import { emailPattern } from "@/lib/db-utils";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { provisionMember } from "@/lib/onboarding";
import { PRESENTED_BY_PATH } from "@/lib/presented-by";
import { sponsorTermEnd } from "@/lib/sponsor-lifecycle";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface SponsorInput {
  name: string;
  /** Tier slug — static hierarchy or a custom tier synced from TSLS. */
  tier: string;
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

/**
 * Resolve a tier value against the synced TSLS catalog before falling back
 * to the static normalizer — a custom tier created in TSLS Event Planning
 * must survive a save here instead of collapsing to "partner".
 */
async function resolveTierValue(raw: string): Promise<string> {
  const { normalizeSponsorTier, SPONSOR_TIERS } = await import(
    "@/lib/sponsor-tiers"
  );
  const value = raw.trim();
  if (SPONSOR_TIERS.some((t) => t.value === value)) return value;
  if (value) {
    try {
      const { data } = await createServiceClient()
        .from("sponsor_tiers")
        .select("value")
        .eq("value", value)
        .maybeSingle();
      if (data?.value) return value;
    } catch {
      // pre-0067 — static list decides
    }
  }
  return normalizeSponsorTier(value);
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

/** Per-sponsor grant of FULL Momentum+ Pro tickets (one year each) that the
    sponsor hands out from their Studio — like the VIP override, but Pro. */
export async function saveSponsorProTickets(
  sponsorId: string,
  total: number,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };
  const { setSponsorProTickets } = await import("@/lib/sponsor-team");
  const value =
    Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const { error } = await setSponsorProTickets(sponsorId, value);
  if (error) return { ok: false, message: error };
  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsor");
  return {
    ok: true,
    message:
      value === 0
        ? "Pro tickets cleared for this sponsor."
        : `This sponsor can now hand out ${value} full Momentum+ Pro membership${value === 1 ? "" : "s"} (1 year each) from their Studio.`,
  };
}

export async function createSponsor(input: SponsorInput): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Created (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const tier = await resolveTierValue(input.tier);
  // Same lifecycle default as the invite flow: a season term ending next
  // April 1 (Host Sponsor stays ongoing). A manually-added sponsor used to
  // get NO term — instantly live and never expiring, the opposite of an
  // invited sponsor, with nothing in the form saying so.
  const termEnd = tier === "host" ? null : sponsorTermEnd().toISOString();
  const row = {
    name: input.name.trim(),
    tier,
    tagline: input.tagline.trim() || null,
    description: input.description.trim() || null,
    offer: input.offer.trim() || null,
    website: input.website.trim() || null,
    rail_active: input.railActive,
    expires_at: termEnd,
  };
  let { error } = await admin.from("sponsors").insert(row);
  if (error && error.message.includes("description")) {
    // Pre-migration fallback: the column arrives with 0033.
    const { description: _drop, ...legacy } = row;
    ({ error } = await admin.from("sponsors").insert(legacy));
  }
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  const { sponsorLive, upcomingSponsorReveal } = await import(
    "@/lib/sponsor-lifecycle"
  );
  const liveNow =
    !termEnd || sponsorLive({ archivedAt: null, expiresAt: termEnd });
  return {
    ok: true,
    message: !termEnd
      ? "Sponsor created — ongoing Host Sponsor, visible to members now."
      : liveNow
        ? `Sponsor created — visible to members now, season ends ${new Date(termEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Use "Make ongoing" to remove the end date.`
        : `Sponsor created — goes live to members ${upcomingSponsorReveal().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, season ends ${new Date(termEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Use "Make ongoing" to publish it immediately with no end date.`,
  };
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
  updateTag("sponsors");
  updateTag("presented-by");
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
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  return { ok: true, message: "Sponsor deleted." };
}

/**
 * Attach a member to a sponsor. They get (or keep) an ongoing Pro membership
 * for as long as they hold a seat with at least one sponsor, a MANAGER seat
 * (an admin-linked person is the business's own staff — they review the
 * page and add artwork; Matt, 2026-07-20), and a welcome email with a
 * button to their Sponsor Studio. New emails are invited through the normal
 * first-login flow. Seat counts per sponsorship tier aren't enforced yet.
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

  // Season-bound expiry (not null): if the sponsorship simply lapses at the
  // season end and nobody archives it, the reconcile sweep can still revoke
  // this Pro comp. A null expiry would grant Pro forever.
  const termEnd = sponsorTermEnd().toISOString();
  const res = await provisionMember({
    email,
    tier: "pro",
    months: null,
    source: "sponsor",
    accessExpiresAt: termEnd,
  });
  if (!res.ok) return { ok: false, message: res.message };

  const admin = createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name")
    .ilike("email", emailPattern(email))
    .maybeSingle();
  if (!profile) return { ok: false, message: "Could not find that member." };

  // Manager seat so the Studio (and its artwork uploads) opens for them.
  // An existing owner/manager seat keeps its role.
  const { data: seat } = await admin
    .from("sponsor_members")
    .select("role")
    .eq("sponsor_id", sponsorId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  let seatError: { message: string } | null = null;
  if (!seat) {
    ({ error: seatError } = await admin
      .from("sponsor_members")
      .insert({ sponsor_id: sponsorId, profile_id: profile.id, role: "manager" }));
    if (seatError && /role/.test(seatError.message)) {
      // Pre-migration-0039 fallback: seat without a role column.
      ({ error: seatError } = await admin
        .from("sponsor_members")
        .insert({ sponsor_id: sponsorId, profile_id: profile.id }));
    }
  } else if (((seat as { role?: string }).role ?? "member") === "member") {
    ({ error: seatError } = await admin
      .from("sponsor_members")
      .update({ role: "manager" })
      .eq("sponsor_id", sponsorId)
      .eq("profile_id", profile.id));
  }
  if (seatError) return { ok: false, message: seatError.message };

  // Welcome email: a button into their Sponsor Studio to review the page —
  // best-effort, the link already succeeded. Skipped entirely while sponsor
  // emails are paused (Matt, 2026-07-29).
  let emailNote = "";
  const { sponsorEmailsEnabled } = await import("@/lib/sponsor-emails");
  if (!(await sponsorEmailsEnabled())) {
    revalidatePath("/admin/sponsors");
    updateTag("sponsors");
    updateTag("presented-by");
    return {
      ok: true,
      message: `${email} linked — they hold Pro while sponsoring and can manage the business page. No welcome email was sent (sponsor emails are paused).`,
    };
  }
  try {
    const { data: sponsor } = await admin
      .from("sponsors")
      .select("name, logo_url")
      .eq("id", sponsorId)
      .maybeSingle();
    const sponsorName = (sponsor?.name as string) ?? "your business";
    const missingArt = !sponsor?.logo_url;
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const firstName =
      ((profile.full_name as string) ?? "").trim().split(/\s+/)[0] || "there";
    const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 12px;font-size:14px;">Hi ${esc(firstName)},</p>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">
        You&rsquo;ve been added to <strong>${esc(sponsorName)}</strong>&rsquo;s
        sponsorship on Momentum+. That comes with full Momentum+ Pro access
        while the sponsorship runs — and you can manage the business&rsquo;s
        page.
      </p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
        Take a minute to review your business profile${
          missingArt
            ? " — it doesn&rsquo;t have a logo yet, and pages with artwork get far more attention"
            : ""
        }. You can update the description, member offer, logo, and ad artwork
        anytime.
      </p>
      <p style="margin:0 0 6px;">
        <a href="${site}/sponsor" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:4px;text-decoration:none;">Review your business profile</a>
      </p>
      <p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af;">
        Sign in with this email address to open your Sponsor Studio.
      </p>
    </div>
  </div>`;
    const { sendEmailViaGhl } = await import("@/lib/notifications");
    const sendRes = await sendEmailViaGhl({
      email,
      subject: `[Momentum+] You're on ${sponsorName}'s sponsor team`,
      html,
    });
    emailNote = sendRes.sent
      ? " We emailed them a link to review the business page."
      : ` (Heads up: the welcome email couldn't be sent — ${sendRes.reason ?? "unknown"}.)`;
  } catch {
    emailNote = " (Heads up: the welcome email couldn't be sent.)";
  }

  revalidatePath("/admin/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  return {
    ok: true,
    message:
      (res.invited
        ? `${email} invited and linked — they hold Pro while sponsoring and can manage the business page.`
        : `${email} linked — they hold Pro while sponsoring and can manage the business page.`) +
      emailNote,
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
  updateTag("sponsors");
  updateTag("presented-by");
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
    tier: await resolveTierValue(input.tier),
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
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  // Two-way sync (Matt, 2026-07-29): mirror the edit onto TSLS's sponsor
  // page. TSLS stores tier labels, so send the label.
  {
    const { sponsorTierLabel } = await import("@/lib/sponsor-tiers");
    const { pushSponsorToTsls, mirrorToTslsAfterResponse } = await import(
      "@/lib/tsls-bridge"
    );
    mirrorToTslsAfterResponse(`sponsor ${row.name}`, () =>
      pushSponsorToTsls({
        name: row.name,
        tier: sponsorTierLabel(row.tier),
        tagline: row.tagline,
        description: row.description,
        website: row.website,
      }),
    );
  }
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
  // NOTE: no processing — bytes are stored exactly as uploaded. The 07-29
  // auto-trim corrupted logos in production (fine in local repro; root cause
  // not yet identified), so nothing touches image bytes until that's solved.
  const bytes: Buffer = Buffer.from(await file.arrayBuffer());

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
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/sponsors");
  updateTag("sponsors");
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
  updateTag("sponsors");
  updateTag("presented-by");
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
  updateTag("sponsors");
  updateTag("presented-by");
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
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/", "layout");
  return { ok: true, message: "Ad graphic removed." };
}


/* =====================================================================
   Sponsor lifecycle (Matt, 2026-07-17): invite a sponsor rep by email;
   they self-serve the business + personal details at /sponsor-onboarding.
   Sponsorships and rep Pro access run through April 1; archived/expired
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
  // The whole invite flow runs on email (Supabase's invite or our setup
  // email) — while sponsor emails are paused it would just create a dead
  // account, so stop before touching anything.
  {
    const { sponsorEmailsEnabled } = await import("@/lib/sponsor-emails");
    if (!(await sponsorEmailsEnabled())) {
      return {
        ok: false,
        message:
          "Sponsor emails are paused — nothing was sent and no account was created. Turn sponsor emails on above when the systems are ready, or add the business with \"Add a sponsor\" below (that never emails anyone).",
      };
    }
  }
  const tier = await resolveTierValue(tierRaw);

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

  // Existing accounts get no Supabase invite email — without our own email
  // the invite silently dies unless the admin remembers to chase it.
  let existingNote = "";
  if (!invited && !accountCreated) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const { sponsorTierLabel } = await import("@/lib/sponsor-tiers");
    try {
      const { sendEmailViaGhl } = await import("@/lib/notifications");
      const res = await sendEmailViaGhl({
        email,
        subject: `[Momentum+] Set up ${businessName.trim() || "your business"}'s sponsor page`,
        html: `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 12px;font-size:14px;">Hello,</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
        ${businessName.trim() ? `<strong>${esc(businessName.trim())}</strong> is` : "You&rsquo;re"} joining
        Momentum+ as a ${esc(sponsorTierLabel(tier))}. Sign in with this email
        address and a short setup builds your sponsor page — logo, offer, and
        your team&rsquo;s access come with it.
      </p>
      <p style="margin:0 0 6px;">
        <a href="${site}/sponsor-onboarding" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:4px;text-decoration:none;">Set up your sponsor page</a>
      </p>
    </div>
  </div>`,
      });
      existingNote = res.sent
        ? ` We emailed them the setup link.`
        : ` (The setup email couldn't be sent — ${res.reason ?? "unknown"} — so send them momentumplus.co/sponsor-onboarding yourself.)`;
    } catch {
      existingNote =
        " (The setup email couldn't be sent — send them momentumplus.co/sponsor-onboarding yourself.)";
    }
  }

  revalidatePath("/admin/sponsors");
  return {
    ok: true,
    loginLink,
    message: invited
      ? `Invite sent to ${email} — the email walks them through adding their business and their own details.`
      : loginLink
        ? `Account created but the invite email failed to send — copy the sign-in link below and send it to ${email} yourself.`
        : `${email} already has a Momentum+ account — they'll be routed to sponsor setup next time they sign in.${existingNote}`,
  };
}

/**
 * Withdraw a pending sponsor invite. Stale invites are worse than clutter:
 * the /welcome and /expired self-heals route that email into sponsor
 * onboarding on every login. The auth account (if one was created) is
 * untouched. If onboarding already created a sponsor page (a retry that
 * stalled), the page stays and can be archived/deleted from the table.
 */
export async function cancelSponsorInvite(inviteId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Invite cancelled (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };
  const { error } = await createServiceClient()
    .from("sponsor_invites")
    .delete()
    .eq("id", inviteId)
    .is("completed_at", null);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  return { ok: true, message: "Invite cancelled — that email now logs in as a regular account." };
}

/**
 * Toggle a sponsorship between the season term and ONGOING (no end date).
 * Ongoing sponsors never come down automatically — and with no season start
 * to wait for, they're visible to members immediately. Seat holders' comped
 * access follows the term; VIP-ticket grants keep their own 3-month clock.
 */
export async function setSponsorOngoing(
  sponsorId: string,
  ongoing: boolean,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const termEnd = ongoing ? null : sponsorTermEnd().toISOString();
  const { error } = await admin
    .from("sponsors")
    .update({ expires_at: termEnd })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  const { data: seats } = await admin
    .from("sponsor_members")
    .select("profile_id")
    .eq("sponsor_id", sponsorId);
  const seatIds = (seats ?? []).map((r) => r.profile_id as string);
  if (seatIds.length > 0) {
    await admin
      .from("memberships")
      .update({ access_expires_at: termEnd })
      .in("profile_id", seatIds)
      .eq("source", "sponsor")
      .eq("status", "active")
      .neq("tier", "vip");
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  return {
    ok: true,
    message: ongoing
      ? "Ongoing sponsorship — no end date. They're visible to members now, never come down automatically, and their team's access doesn't expire."
      : `Back on the season clock — this sponsorship and its team's access now end ${new Date(termEnd as string).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
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
  updateTag("sponsors");
  updateTag("presented-by");
  return {
    ok: true,
    message:
      "Moved to Past Sponsors — hidden from members, reps' sponsor access ended. Reinstate anytime.",
  };
}

/** Bring a past sponsor back: visible again, term through next April 1,
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
  const { data: row } = await admin
    .from("sponsors")
    .select("tier")
    .eq("id", sponsorId)
    .maybeSingle();
  // Host Sponsor comes back with no end date; everyone else gets the season.
  const termEnd =
    row?.tier === "host" ? null : sponsorTermEnd().toISOString();
  const { error } = await admin
    .from("sponsors")
    .update({ archived_at: null, expires_at: termEnd })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  // Restore each seat's access through the new term AT THE TIER THEY HAD —
  // a VIP-ticket holder comes back as VIP, an admin-linked seat as Pro, the
  // owner as sponsor. (The old code upgraded ticket holders to Pro.)
  const { reactivateSponsorMembership } = await import(
    "@/lib/sponsor-membership"
  );
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
    await reactivateSponsorMembership(id, termEnd, reps.has(id));
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  // "Visible again" is only true when the reinstated term is inside the live
  // season — on the standard April clock that is always the case.
  const { sponsorLive, upcomingSponsorReveal } = await import(
    "@/lib/sponsor-lifecycle"
  );
  const liveNow =
    !termEnd || sponsorLive({ archivedAt: null, expiresAt: termEnd });
  return {
    ok: true,
    message: !termEnd
      ? "Reinstated as the ongoing Host Sponsor — visible to members again with no end date."
      : liveNow
        ? `Reinstated through ${new Date(termEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} — visible to members again, reps' Pro access restored.`
        : `Reinstated through ${new Date(termEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} — reps' Pro access restored. Members see the page again on ${upcomingSponsorReveal().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} (pre-season until then).`,
  };
}

/* =====================================================================
   2026 interest list (Matt, 2026-07-29): interest-form submissions live
   as PROSPECT rows — hidden from members, no term, no seats, no emails —
   until an admin confirms the sponsorship here.
   ===================================================================== */

/**
 * Promote a prospect to a real sponsor: same lifecycle as "Add a sponsor"
 * (season term ending next April 1; Host stays ongoing). Sends nothing —
 * inviting their rep is a separate, deliberate step.
 */
export async function confirmProspect(sponsorId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Confirmed (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data: row, error: readError } = await admin
    .from("sponsors")
    .select("tier, prospect")
    .eq("id", sponsorId)
    .maybeSingle();
  if (readError && /prospect/.test(readError.message)) {
    return {
      ok: false,
      message:
        "Run migration 0062 in the Supabase SQL editor first — it adds the prospect columns.",
    };
  }
  if (!row) return { ok: false, message: "Could not find that prospect." };
  if (!row.prospect) {
    return { ok: false, message: "They're already a confirmed sponsor." };
  }

  const termEnd = row.tier === "host" ? null : sponsorTermEnd().toISOString();
  const { error } = await admin
    .from("sponsors")
    .update({ prospect: false, expires_at: termEnd })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  const { sponsorLive, upcomingSponsorReveal } = await import(
    "@/lib/sponsor-lifecycle"
  );
  const liveNow =
    !termEnd || sponsorLive({ archivedAt: null, expiresAt: termEnd });
  const when = termEnd
    ? new Date(termEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  return {
    ok: true,
    message: !termEnd
      ? "Confirmed — ongoing sponsor, visible to members now. No emails were sent."
      : liveNow
        ? `Confirmed — visible to members now, season ends ${when}. No emails were sent.`
        : `Confirmed — goes live to members ${upcomingSponsorReveal().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, season ends ${when}. No emails were sent; invite their rep when you're ready.`,
  };
}

/**
 * Pull the logo files and websites the 2026 interest form collected (GHL
 * uploads) into the sponsor rows — logo and website fill only where the
 * row has none, so nothing an admin or sponsor set is ever overwritten.
 * Every sponsor row is considered, prospect or confirmed. Skipped and
 * failed items are reported by name so nothing silently vanishes.
 */
export async function importInterestFormAssets(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Imported (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { assetsForName, sniffImage } = await import(
    "@/lib/interest-form-assets"
  );
  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("sponsors")
    .select("id, name, logo_url, website");
  if (error) return { ok: false, message: error.message };

  const targets = (rows ?? [])
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      logoUrl: (r.logo_url as string | null) ?? null,
      website: (r.website as string | null) ?? null,
      assets: assetsForName(r.name as string),
    }))
    .filter((r) => r.assets);

  const logosDone: string[] = [];
  const sitesDone: string[] = [];
  const skipped: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  const importOne = async (t: (typeof targets)[number]) => {
    const patch: Record<string, string> = {};
    if (!t.website?.trim() && t.assets?.website) {
      patch.website = t.assets.website;
    }
    if (t.logoUrl) {
      skipped.push(t.name);
    } else {
      let reason = "no usable image among their uploads";
      for (const url of t.assets?.logoUrls ?? []) {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(10000),
            cache: "no-store",
          });
          if (!res.ok) {
            reason = `download failed (${res.status})`;
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 4 * 1024 * 1024) {
            reason = "file over 4 MB";
            continue;
          }
          const kind = sniffImage(new Uint8Array(buf.subarray(0, 512)));
          if (!kind) {
            // The form accepted anything — PDFs and EPS files need a
            // manual export to PNG/JPG/SVG before they can be a logo.
            reason = "not a web image (likely PDF/EPS — convert manually)";
            continue;
          }
          const path = `${t.id}.${kind.ext}`;
          const { error: upErr } = await admin.storage
            .from("sponsor-logos")
            .upload(path, buf, { contentType: kind.contentType, upsert: true });
          if (upErr) {
            reason = upErr.message;
            continue;
          }
          const { data: pub } = admin.storage
            .from("sponsor-logos")
            .getPublicUrl(path);
          patch.logo_url = `${pub.publicUrl}?v=${Date.now()}`;
          logosDone.push(t.name);
          reason = "";
          break;
        } catch {
          reason = "download timed out or was blocked";
        }
      }
      if (reason) failed.push({ name: t.name, reason });
    }
    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await admin
        .from("sponsors")
        .update(patch)
        .eq("id", t.id);
      if (updErr) {
        failed.push({ name: t.name, reason: updErr.message });
      } else if (patch.website) {
        sitesDone.push(t.name);
      }
    }
  };

  // Small parallel batches: ~30 downloads sequentially would flirt with the
  // action timeout; unbounded parallelism would hammer GHL.
  const BATCH = 6;
  for (let i = 0; i < targets.length; i += BATCH) {
    await Promise.all(targets.slice(i, i + BATCH).map(importOne));
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  const parts = [
    `${logosDone.length} logo${logosDone.length === 1 ? "" : "s"} imported`,
    `${sitesDone.length} website${sitesDone.length === 1 ? "" : "s"} filled`,
  ];
  if (skipped.length > 0) {
    parts.push(`${skipped.length} already had a logo (untouched)`);
  }
  const failNote =
    failed.length > 0
      ? ` Needs a hand: ${failed
          .slice(0, 8)
          .map((f) => `${f.name} — ${f.reason}`)
          .join("; ")}${failed.length > 8 ? `; +${failed.length - 8} more` : ""}.`
      : "";
  return { ok: true, message: `${parts.join(", ")}.${failNote}` };
}

/**
 * RECOVERY for the 07-29 trim incident: the batch trim corrupted stored
 * logo files in production. The originals still exist on GHL (the interest
 * form's uploads), so this re-downloads each sponsor's original file and
 * stores it EXACTLY as downloaded — no processing — overwriting whatever
 * is at the sponsor's logo path now. Covers every sponsor the form knows
 * by name; logos that never came from the form must be re-uploaded by hand
 * (uploads no longer touch image bytes either). Each restore also reports
 * the byte-size and magic bytes of the file it replaced, for diagnosis.
 */
export async function restoreFormLogos(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Restored (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { assetsForName, sniffImage } = await import(
    "@/lib/interest-form-assets"
  );
  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("sponsors")
    .select("id, name, logo_url");
  if (error) return { ok: false, message: error.message };

  const restored: string[] = [];
  const noSource: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  const restoreOne = async (r: {
    id: string;
    name: string;
    logo_url: string | null;
  }) => {
    const assets = assetsForName(r.name);
    if (!assets || assets.logoUrls.length === 0) {
      noSource.push(r.name);
      return;
    }
    // What's in storage right now (the possibly-corrupt file) — captured
    // for the report so the incident can be diagnosed from real bytes.
    let brokenNote = "no stored file";
    if (r.logo_url) {
      const clean = r.logo_url.split("?")[0];
      const marker = "/sponsor-logos/";
      const idx = clean.indexOf(marker);
      if (idx >= 0) {
        const { data: cur } = await admin.storage
          .from("sponsor-logos")
          .download(decodeURIComponent(clean.slice(idx + marker.length)));
        if (cur) {
          const curBuf = Buffer.from(await cur.arrayBuffer());
          brokenNote = `was ${curBuf.length}B [${curBuf.subarray(0, 4).toString("hex")}]`;
        }
      }
    }
    let reason = "no usable image among their uploads";
    for (const url of assets.logoUrls) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        });
        if (!res.ok) {
          reason = `download failed (${res.status})`;
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const kind = sniffImage(new Uint8Array(buf.subarray(0, 512)));
        if (!kind) {
          reason = "not a web image (likely PDF/EPS)";
          continue;
        }
        const path = `${r.id}.${kind.ext}`;
        const { error: upErr } = await admin.storage
          .from("sponsor-logos")
          .upload(path, buf, { contentType: kind.contentType, upsert: true });
        if (upErr) {
          reason = upErr.message;
          continue;
        }
        const { data: pub } = admin.storage
          .from("sponsor-logos")
          .getPublicUrl(path);
        const { error: updErr } = await admin
          .from("sponsors")
          .update({ logo_url: `${pub.publicUrl}?v=${Date.now()}` })
          .eq("id", r.id);
        if (updErr) {
          reason = updErr.message;
          break;
        }
        restored.push(`${r.name} (${brokenNote} → ${buf.length}B fresh)`);
        reason = "";
        break;
      } catch {
        reason = "download timed out or was blocked";
      }
    }
    if (reason) failed.push({ name: r.name, reason });
  };

  const targets = (rows ?? []) as {
    id: string;
    name: string;
    logo_url: string | null;
  }[];
  const BATCH = 6;
  for (let i = 0; i < targets.length; i += BATCH) {
    await Promise.all(targets.slice(i, i + BATCH).map(restoreOne));
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/", "layout");

  const parts = [
    restored.length > 0
      ? `Restored ${restored.length}: ${restored.slice(0, 10).join("; ")}${restored.length > 10 ? `; +${restored.length - 10} more` : ""}`
      : "Nothing restored",
  ];
  if (noSource.length > 0) {
    parts.push(
      `no form file for ${noSource.length} (re-upload by hand): ${noSource.slice(0, 6).join(", ")}${noSource.length > 6 ? `, +${noSource.length - 6} more` : ""}`,
    );
  }
  const failNote =
    failed.length > 0
      ? ` Failed: ${failed
          .slice(0, 8)
          .map((f) => `${f.name} — ${f.reason}`)
          .join("; ")}${failed.length > 8 ? `; +${failed.length - 8} more` : ""}.`
      : "";
  return { ok: true, message: `${parts.join(". ")}.${failNote}` };
}

/**
 * Trim margins off every sponsor logo — the rebuilt, non-destructive
 * version (see lib/logo-derivative for the safety design: originals are
 * never touched, every write is verified byte-for-byte before a row
 * points at it, and undoTrimLogos flips everything back).
 */
export async function trimLogosSafe(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Trimmed (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { applyTrimmedLogo, rawPathFor, storagePathFromUrl } = await import(
    "@/lib/logo-derivative"
  );
  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("sponsors")
    .select("id, name, logo_url")
    .not("logo_url", "is", null);
  if (error) return { ok: false, message: error.message };

  const trimmed: string[] = [];
  let untouched = 0;
  const failed: { name: string; reason: string }[] = [];

  const doOne = async (r: { id: string; name: string; logo_url: string }) => {
    const path = storagePathFromUrl(r.logo_url);
    if (!path) {
      failed.push({ name: r.name, reason: "logo isn't in the app's storage" });
      return;
    }
    // Always trim from the ORIGINAL, so re-runs never re-trim a trim.
    const result = await applyTrimmedLogo(admin, rawPathFor(path));
    if (result.outcome === "trimmed" && result.url) {
      const { error: updErr } = await admin
        .from("sponsors")
        .update({ logo_url: result.url })
        .eq("id", r.id);
      if (updErr) failed.push({ name: r.name, reason: updErr.message });
      else trimmed.push(`${r.name} (${result.detail})`);
    } else if (
      result.outcome === "already-tight" ||
      result.outcome === "svg"
    ) {
      untouched += 1;
    } else {
      failed.push({ name: r.name, reason: result.detail });
    }
  };

  const targets = (rows ?? []) as { id: string; name: string; logo_url: string }[];
  const BATCH = 6;
  for (let i = 0; i < targets.length; i += BATCH) {
    await Promise.all(targets.slice(i, i + BATCH).map(doOne));
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/", "layout");

  const parts = [
    trimmed.length > 0
      ? `Trimmed ${trimmed.length}: ${trimmed.slice(0, 10).join("; ")}${trimmed.length > 10 ? `; +${trimmed.length - 10} more` : ""}`
      : "Nothing needed trimming",
  ];
  if (untouched > 0) parts.push(`${untouched} already tight or SVG`);
  parts.push("originals kept — Undo restores them");
  const failNote =
    failed.length > 0
      ? ` Left as-is: ${failed
          .slice(0, 8)
          .map((f) => `${f.name} — ${f.reason}`)
          .join("; ")}${failed.length > 8 ? `; +${failed.length - 8} more` : ""}.`
      : "";
  return { ok: true, message: `${parts.join(", ")}.${failNote}` };
}

/** Point every trimmed logo back at its untouched original. */
export async function undoTrimLogos(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Undone (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { BUCKET, isTrimPath, rawPathFor, storagePathFromUrl } = await import(
    "@/lib/logo-derivative"
  );
  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("sponsors")
    .select("id, name, logo_url")
    .not("logo_url", "is", null);
  if (error) return { ok: false, message: error.message };

  const reverted: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const r of (rows ?? []) as {
    id: string;
    name: string;
    logo_url: string;
  }[]) {
    const path = storagePathFromUrl(r.logo_url);
    if (!path || !isTrimPath(path)) continue;
    const rawPath = rawPathFor(path);
    const { data: exists } = await admin.storage
      .from(BUCKET)
      .download(rawPath);
    if (!exists) {
      failed.push({ name: r.name, reason: "original file not found" });
      continue;
    }
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(rawPath);
    const { error: updErr } = await admin
      .from("sponsors")
      .update({ logo_url: `${pub.publicUrl}?v=${Date.now()}` })
      .eq("id", r.id);
    if (updErr) failed.push({ name: r.name, reason: updErr.message });
    else reverted.push(r.name);
  }

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  updateTag("sponsors");
  updateTag("presented-by");
  revalidatePath("/", "layout");

  const failNote =
    failed.length > 0
      ? ` Couldn't revert: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`
      : "";
  return {
    ok: true,
    message:
      (reverted.length > 0
        ? `Back to originals for ${reverted.length}: ${reverted.slice(0, 10).join(", ")}${reverted.length > 10 ? `, +${reverted.length - 10} more` : ""}`
        : "No trimmed logos to undo") + `.${failNote}`,
  };
}

/**
 * Push every live sponsor listing to TSLS in one pass (Matt, 2026-07-29:
 * the Momentum+ Sponsor — and anything else that only exists here — must
 * appear on the TSLS sponsors page too). Uses the same per-sponsor bridge
 * as edit-triggered syncs; TSLS matches by name, creates what's missing,
 * and never overwrites a filled field with a blank.
 */
export async function syncRosterToTsls(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Synced (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("sponsors")
    .select("name, tier, tagline, description, website, logo_url, prospect, archived_at")
    .is("archived_at", null);
  if (error) return { ok: false, message: error.message };

  const { sponsorTierLabel } = await import("@/lib/sponsor-tiers");
  const { pushSponsorToTsls } = await import("@/lib/tsls-bridge");
  const live = (rows ?? []).filter((r) => !r.prospect);
  const pushed: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const r of live) {
    const result = await pushSponsorToTsls({
      name: String(r.name),
      tier: sponsorTierLabel(String(r.tier ?? "")),
      tagline: (r.tagline as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      website: (r.website as string | null) ?? null,
      logoUrl: (r.logo_url as string | null) ?? null,
    });
    if (result.ok) pushed.push(String(r.name));
    else failed.push({ name: String(r.name), reason: result.message ?? "failed" });
  }
  const failNote =
    failed.length > 0
      ? ` Failed: ${failed
          .slice(0, 6)
          .map((f) => `${f.name} — ${f.reason}`)
          .join("; ")}${failed.length > 6 ? `; +${failed.length - 6} more` : ""}.`
      : "";
  return {
    ok: failed.length === 0,
    message: `Pushed ${pushed.length} sponsor${pushed.length === 1 ? "" : "s"} to TSLS.${failNote}`,
  };
}

/**
 * The sponsor-email master switch. OFF by default (Matt, 2026-07-29): no
 * emails to sponsors from either platform until he flips it on.
 */
export async function saveSponsorEmailsEnabled(
  enabled: boolean,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };
  const { setSponsorEmailsEnabled } = await import("@/lib/sponsor-emails");
  const { error } = await setSponsorEmailsEnabled(enabled);
  if (error) return { ok: false, message: error };
  revalidatePath("/admin/sponsors");
  return {
    ok: true,
    message: enabled
      ? "Sponsor emails are ON — invites and welcome emails send normally now."
      : "Sponsor emails are paused — nothing in the app emails a sponsor until you turn this back on.",
  };
}
