"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { upsertSponsorMembership } from "@/lib/sponsor-membership";
import {
  inviteProTicketUsers,
  inviteTicketUsers,
  listSponsorTeam,
  resolveSponsorActor,
  type SponsorRole,
} from "@/lib/sponsor-team";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Sponsor Studio actions. Authorization model (Matt, 2026-07-18):
 * - owner: everything (edit page, hand out tickets, promote/demote,
 *   transfer ownership).
 * - manager: edit the page only.
 * - member (VIP-ticket holder): nothing here — no edit rights.
 * - Super Admin: everything, on any sponsor.
 */

export interface StudioResult {
  ok: boolean;
  message?: string;
}

function refreshSponsorSurfaces(): void {
  revalidatePath("/sponsor");
  revalidatePath("/sponsors");
  revalidatePath("/admin/sponsors");
  revalidateTag("sponsors");
  revalidateTag("presented-by");
}

async function requireStudioActor(
  sponsorId: string,
  minRole: "owner" | "manager",
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const actor = await resolveSponsorActor(sponsorId);
  if (!actor.ok || !actor.userId) {
    return { ok: false, message: actor.message ?? "Please sign in first." };
  }
  if (actor.isSuperAdmin) return { ok: true, userId: actor.userId };
  const allowed: SponsorRole[] = minRole === "owner" ? ["owner"] : ["owner", "manager"];
  if (actor.role && allowed.includes(actor.role)) {
    return { ok: true, userId: actor.userId };
  }
  return {
    ok: false,
    message:
      minRole === "owner"
        ? "Only the page's primary manager (or a Super Admin) can do that."
        : "Only the page's managers can edit it.",
  };
}

const SPONSOR_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/**
 * Managers upload their own logo and ad artwork (same rules and storage
 * paths as the admin uploads, so either side can replace the other's).
 */
export async function uploadOwnSponsorImage(
  sponsorId: string,
  kind: "logo" | "ad",
  formData: FormData,
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Uploaded (preview mode)." };
  }
  const auth = await requireStudioActor(sponsorId, "manager");
  if (!auth.ok) return auth;

  const label = kind === "logo" ? "Logo" : "Ad artwork";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file received — choose an image and try again." };
  }
  if (file.size > 2 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `${label} is ${mb} MB — the limit is 2 MB. Compress or resize the image and try again.`,
    };
  }
  const ext = SPONSOR_IMAGE_TYPES[file.type];
  if (!ext) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — upload a PNG, JPG, SVG, or WebP.`,
    };
  }

  const admin = createServiceClient();
  await admin.storage
    .createBucket("sponsor-logos", { public: true })
    .catch(() => undefined);
  const path = kind === "logo" ? `${sponsorId}.${ext}` : `${sponsorId}-ad.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from("sponsor-logos")
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };
  const { data: pub } = admin.storage.from("sponsor-logos").getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`;
  const { error } = await admin
    .from("sponsors")
    .update(kind === "logo" ? { logo_url: url } : { sidebar_ad_url: url })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  refreshSponsorSurfaces();
  revalidatePath("/", "layout");
  return { ok: true, message: `${label} uploaded.` };
}

export async function updateSponsorPage(
  sponsorId: string,
  input: {
    tagline: string;
    description: string;
    offer: string;
    website: string;
  },
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const auth = await requireStudioActor(sponsorId, "manager");
  if (!auth.ok) return auth;

  const website = input.website.trim();
  if (website && !/^https?:\/\//i.test(website)) {
    return { ok: false, message: "The website link needs to start with http(s)://." };
  }
  const { error } = await createServiceClient()
    .from("sponsors")
    .update({
      tagline: input.tagline.trim().slice(0, 200) || null,
      description: input.description.trim().slice(0, 4000) || null,
      offer: input.offer.trim().slice(0, 500) || null,
      website: website.slice(0, 300) || null,
    })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  refreshSponsorSurfaces();
  return { ok: true, message: "Page updated." };
}

export async function sendTicketInvites(
  sponsorId: string,
  emailsText: string,
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Invited (preview mode)." };
  }
  const auth = await requireStudioActor(sponsorId, "owner");
  if (!auth.ok) return auth;

  const admin = createServiceClient();
  const { data: sponsor } = await admin
    .from("sponsors")
    .select("id")
    .eq("id", sponsorId)
    .maybeSingle();
  if (!sponsor) return { ok: false, message: "Sponsor not found." };

  const emails = emailsText
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (emails.length === 0) {
    return { ok: false, message: "Add at least one email address." };
  }

  const summary = await inviteTicketUsers({ id: sponsor.id as string }, emails);
  const parts: string[] = [];
  if (summary.invited.length > 0) {
    parts.push(
      `${summary.invited.length} VIP invite${summary.invited.length === 1 ? "" : "s"} sent.`,
    );
  }
  if (summary.existing.length > 0) {
    parts.push(`${summary.existing.length} already on the team.`);
  }
  for (const f of summary.failed) {
    parts.push(`${f.email}: ${f.reason}.`);
  }
  parts.push(
    `${summary.remaining} ticket${summary.remaining === 1 ? "" : "s"} remaining.`,
  );
  refreshSponsorSurfaces();
  return { ok: summary.failed.length === 0, message: parts.join(" ") };
}

/** Hand out the sponsor's admin-granted Momentum+ Pro tickets — a full Pro
    membership for one year per person. Owner (or Super Admin) only. */
export async function sendProTicketInvites(
  sponsorId: string,
  emailsText: string,
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Invited (preview mode)." };
  }
  const auth = await requireStudioActor(sponsorId, "owner");
  if (!auth.ok) return auth;

  const emails = emailsText
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (emails.length === 0) {
    return { ok: false, message: "Add at least one email address." };
  }

  const summary = await inviteProTicketUsers({ id: sponsorId }, emails);
  const parts: string[] = [];
  if (summary.invited.length > 0) {
    parts.push(
      `${summary.invited.length} Pro invite${summary.invited.length === 1 ? "" : "s"} sent (1 year each).`,
    );
  }
  if (summary.existing.length > 0) {
    parts.push(`${summary.existing.length} already on the team.`);
  }
  for (const f of summary.failed) {
    parts.push(`${f.email}: ${f.reason}.`);
  }
  parts.push(
    `${summary.remaining} Pro ticket${summary.remaining === 1 ? "" : "s"} remaining.`,
  );
  refreshSponsorSurfaces();
  return { ok: summary.failed.length === 0, message: parts.join(" ") };
}

export async function setTeamRole(
  sponsorId: string,
  profileId: string,
  role: "manager" | "member",
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Updated (preview mode)." };
  }
  // Server actions receive raw serialized args — the TS union is not a
  // runtime guard. Reject anything but the two roles this action may set;
  // "owner" would otherwise install a second owner and skip the
  // regular-membership gate below (ownership only moves via transfer).
  if (role !== "manager" && role !== "member") {
    return { ok: false, message: "Unknown role." };
  }
  const auth = await requireStudioActor(sponsorId, "owner");
  if (!auth.ok) return auth;

  const team = await listSponsorTeam(sponsorId);
  const target = team.find((s) => s.profileId === profileId);
  if (!target) return { ok: false, message: "That person isn't on this sponsor's team." };
  if (target.role === "owner") {
    return {
      ok: false,
      message: "The primary manager can't be changed here — use Transfer ownership.",
    };
  }
  if (role === "manager" && !target.regularMember) {
    return {
      ok: false,
      message: `${target.name || target.email} needs their own regular Momentum+ membership before they can co-manage the page (sponsor-comped access doesn't count).`,
    };
  }
  const { error } = await createServiceClient()
    .from("sponsor_members")
    .update({ role })
    .eq("sponsor_id", sponsorId)
    .eq("profile_id", profileId);
  if (error) return { ok: false, message: error.message };
  refreshSponsorSurfaces();
  return {
    ok: true,
    message:
      role === "manager"
        ? `${target.name || target.email} can now edit the page.`
        : `${target.name || target.email} is back to member — no edit access.`,
  };
}

export async function transferOwnership(
  sponsorId: string,
  toProfileId: string,
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Transferred (preview mode)." };
  }
  const auth = await requireStudioActor(sponsorId, "owner");
  if (!auth.ok) return auth;

  const admin = createServiceClient();
  const [team, { data: sponsor }] = await Promise.all([
    listSponsorTeam(sponsorId),
    admin
      .from("sponsors")
      .select("id, expires_at")
      .eq("id", sponsorId)
      .maybeSingle(),
  ]);
  if (!sponsor) return { ok: false, message: "Sponsor not found." };
  const oldOwner = team.find((s) => s.role === "owner");
  const target = team.find((s) => s.profileId === toProfileId);
  if (!target) return { ok: false, message: "That person isn't on this sponsor's team." };
  if (target.role === "owner") {
    return { ok: false, message: "They already own this page." };
  }
  // Ownership passes only to a current MANAGER (Matt, 2026-07-20) —
  // otherwise a VIP-ticket guest could inherit the page and its free
  // membership, skipping the manager-eligibility rule entirely.
  if (target.role !== "manager") {
    return {
      ok: false,
      message:
        "Ownership can only be transferred to a current manager. Promote them to manager first (they need their own Momentum+ membership), then transfer.",
    };
  }

  // Grant the NEW owner's free membership first — the most failure-prone
  // step. If it can't be granted, abort before touching roles so the page
  // is never left owner-less or with an ex-owner who lost their membership
  // for nothing.
  const termEnd =
    (sponsor.expires_at as string | null) ?? new Date().toISOString();
  const access = await upsertSponsorMembership(toProfileId, termEnd, true);
  if (access.error) {
    return {
      ok: false,
      message: `Couldn't grant the new owner's membership (${access.error}) — nothing was changed. Try again or ask a Super Admin.`,
    };
  }

  const { error: promoteError } = await admin
    .from("sponsor_members")
    .update({ role: "owner" })
    .eq("sponsor_id", sponsorId)
    .eq("profile_id", toProfileId);
  if (promoteError) {
    return {
      ok: false,
      message: `Couldn't transfer ownership (${promoteError.message}). Nothing was changed.`,
    };
  }
  if (oldOwner) {
    // Demote the old owner to manager (checked — a silent failure would
    // leave two owners).
    const { error: demoteError } = await admin
      .from("sponsor_members")
      .update({ role: "manager" })
      .eq("sponsor_id", sponsorId)
      .eq("profile_id", oldOwner.profileId);
    if (demoteError) {
      // Roll the promotion back so we don't leave two owners.
      await admin
        .from("sponsor_members")
        .update({ role: "member" })
        .eq("sponsor_id", sponsorId)
        .eq("profile_id", toProfileId);
      return {
        ok: false,
        message: `Couldn't complete the transfer (${demoteError.message}). Reverted — the current owner is unchanged.`,
      };
    }

    // End the old owner's free membership — but ONLY if they don't still
    // own another active sponsor page (memberships carry no sponsor_id, so
    // a blind expire would revoke the free membership they need elsewhere).
    const { data: otherOwnerSeats } = await admin
      .from("sponsor_members")
      .select("sponsor_id, sponsors!inner ( archived_at, expires_at )")
      .eq("profile_id", oldOwner.profileId)
      .eq("role", "owner")
      .neq("sponsor_id", sponsorId);
    const stillOwnsElsewhere = (otherOwnerSeats ?? []).some((r) => {
      const sp = r.sponsors as unknown as {
        archived_at: string | null;
        expires_at: string | null;
      };
      return (
        !sp.archived_at &&
        (!sp.expires_at || new Date(sp.expires_at) > new Date())
      );
    });
    if (!stillOwnsElsewhere) {
      await admin
        .from("memberships")
        .update({ status: "expired", access_expires_at: new Date().toISOString() })
        .eq("profile_id", oldOwner.profileId)
        .eq("source", "sponsor")
        .neq("tier", "vip")
        .eq("status", "active");
    }
  }

  refreshSponsorSurfaces();
  return {
    ok: true,
    message: `${target.name || target.email} now owns this page and holds the sponsorship's free membership.${oldOwner ? ` ${oldOwner.name || oldOwner.email} stays on as a manager.` : ""}`,
  };
}
