"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { upsertSponsorMembership } from "@/lib/sponsor-membership";
import {
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
    .select("id, tier")
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

  const summary = await inviteTicketUsers(
    { id: sponsor.id as string, tier: (sponsor.tier as string) ?? "partner" },
    emails,
  );
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

export async function setTeamRole(
  sponsorId: string,
  profileId: string,
  role: "manager" | "member",
): Promise<StudioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Updated (preview mode)." };
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

  // Roles first: target becomes owner; the old owner stays on as a manager
  // (the primary manager keeps manager standing regardless of membership).
  const { error: promoteError } = await admin
    .from("sponsor_members")
    .update({ role: "owner" })
    .eq("sponsor_id", sponsorId)
    .eq("profile_id", toProfileId);
  if (promoteError) return { ok: false, message: promoteError.message };
  if (oldOwner) {
    await admin
      .from("sponsor_members")
      .update({ role: "manager" })
      .eq("sponsor_id", sponsorId)
      .eq("profile_id", oldOwner.profileId);
  }

  // The sponsorship's one free membership follows the owner: end the old
  // owner's free row, grant (or refresh) the new owner's through term end.
  const termEnd =
    (sponsor.expires_at as string | null) ?? new Date().toISOString();
  if (oldOwner) {
    await admin
      .from("memberships")
      .update({ status: "expired", access_expires_at: new Date().toISOString() })
      .eq("profile_id", oldOwner.profileId)
      .eq("source", "sponsor")
      .neq("tier", "vip")
      .eq("status", "active");
  }
  const access = await upsertSponsorMembership(toProfileId, termEnd, true);
  if (access.error) {
    return {
      ok: false,
      message: `Ownership moved, but the free membership couldn't be granted: ${access.error}. A Super Admin can grant it from Admin → Members.`,
    };
  }

  refreshSponsorSurfaces();
  return {
    ok: true,
    message: `${target.name || target.email} now owns this page and holds the sponsorship's free membership.${oldOwner ? ` ${oldOwner.name || oldOwner.email} stays on as a manager.` : ""}`,
  };
}
