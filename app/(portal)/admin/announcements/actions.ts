"use server";
import { revalidatePath } from "next/cache";

import { deliverAnnouncement } from "@/lib/announcements-delivery";
import { profilesWithBadges } from "@/lib/badge-sync";
import { requireAdmin } from "@/lib/auth-helpers";
import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tier } from "@/lib/types";
import { formatAt } from "@/lib/time-format";

export interface AnnouncementInput {
  title: string;
  body: string;
  audienceTiers: Tier[];
  /*
   * Badge keys (lib/badges.ts) this reaches, on top of the tiers — a UNION,
   * not an intersection: "everyone on annual OR anyone who is a Founding
   * Member". Matt, 2026-08-19, wanting to run offers at badge holders.
   * Empty = tiers alone, which is every announcement sent before this.
   */
  audienceBadges?: string[];
  /** "sms" texts ONLY members who opted in to announcement texts (prefs key
      "announcements") AND have a phone number. "community" posts to the
      #announcements chat channel (all members, tiers don't apply). */
  channels: ("email" | "in_app" | "community" | "sms")[];
}

export interface AnnouncementResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
  recipients?: number;
  /** Set when a send stopped partway — pass back to resume safely. */
  announcementId?: string;
}

/** How many members the selected tiers reach — shown in the confirm step.
    smsCount = the subset who opted in to announcement texts AND have a
    phone number (what the SMS channel would actually text). */
export async function previewAnnouncementAudience(
  audienceTiers: Tier[],
  audienceBadges: string[] = [],
): Promise<{ count: number; smsCount: number }> {
  if (
    !isSupabaseConfigured() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (audienceTiers.length === 0 && audienceBadges.length === 0)
  ) {
    return { count: 0, smsCount: 0 };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { count: 0, smsCount: 0 };
  const admin = createServiceClient();
  /*
   * Badge holders are unioned in as a SECOND membership query rather than
   * counted straight off member_badges: a badge is permanent (0091) but
   * access is not, and a lapsed member must not be messaged just because
   * they earned something last year. Delivery applies the same rule.
   */
  const badgeHolders =
    audienceBadges.length > 0 ? await profilesWithBadges(audienceBadges) : null;
  const { rows } = await allRows<{
    profile_id: string;
    tier: string;
    profiles: { phone: string | null } | null;
  }>((from, to) =>
    admin
      .from("memberships")
      .select("profile_id, tier, profiles ( phone )")
      .in("status", ["active", "past_due"])
      .order("profile_id")
      .range(from, to) as unknown as PromiseLike<{
      data:
        | {
            profile_id: string;
            tier: string;
            profiles: { phone: string | null } | null;
          }[]
        | null;
      error: { message: string } | null;
    }>,
  );
  const tierSet = new Set<string>(audienceTiers);
  const matched = rows.filter(
    (r) => tierSet.has(r.tier) || badgeHolders?.has(r.profile_id),
  );
  const withPhone = new Set(
    matched.filter((r) => r.profiles?.phone).map((r) => r.profile_id),
  );
  const audienceIds = new Set(matched.map((r) => r.profile_id));
  const { rows: smsPrefs } = await allRows<{ profile_id: string }>((from, to) =>
    admin
      .from("notification_prefs")
      .select("profile_id")
      .eq("key", "announcements")
      .eq("sms", true)
      .order("profile_id")
      .range(from, to),
  );
  const smsCount = smsPrefs.filter(
    (p) => audienceIds.has(p.profile_id) && withPhone.has(p.profile_id),
  ).length;
  return { count: audienceIds.size, smsCount };
}

/**
 * Admin: send an announcement (SPEC.md §4). Records the announcement, fans
 * out in-app notifications to members in the audience tiers, and emails via
 * GHL when configured — always respecting each member's `platform` prefs.
 *
 * Delivery is journaled per member in announcement_deliveries, so if the
 * fan-out dies partway (timeout, deploy), resending with `resumeId` skips
 * everyone already reached instead of emailing them twice.
 */
export async function sendAnnouncement(
  input: AnnouncementInput,
  resumeId?: string,
): Promise<AnnouncementResult> {
  const communityOnly =
    input.channels.length > 0 &&
    input.channels.every((c) => c === "community");
  if (!input.title.trim()) {
    return { ok: false, message: "Give the announcement a title." };
  }
  if (input.channels.length === 0) {
    return { ok: false, message: "Pick at least one channel." };
  }
  if (
    input.audienceTiers.length === 0 &&
    (input.audienceBadges ?? []).length === 0 &&
    !communityOnly
  ) {
    return {
      ok: false,
      message:
        "Pick at least one audience tier or badge (or send to Community only — that channel reaches everyone).",
    };
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: true,
      preview: true,
      recipients: 0,
      message: "Preview mode — announcement recorded nowhere; connect Supabase to send.",
    };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();

  let announcementId = resumeId ?? null;
  if (announcementId) {
    const { data: existing } = await admin
      .from("announcements")
      .select("id")
      .eq("id", announcementId)
      .maybeSingle();
    if (!existing) announcementId = null;
  }
  if (!announcementId) {
    const badges = input.audienceBadges ?? [];
    const base = {
      title: input.title.trim(),
      body: input.body.trim() || null,
      audience_tiers: input.audienceTiers,
      channels: input.channels,
      sent_at: new Date().toISOString(),
      sent_by: auth.userId,
    };
    let { data: created, error: insertError } = await admin
      .from("announcements")
      .insert({ ...base, audience_badges: badges })
      .select("id")
      .single();
    /*
     * Pre-migration ladder: naming a column the database does not have yet
     * fails the WHOLE insert, so an app deployed ahead of 0091 could not
     * send an ordinary tier announcement at all. Retry without the column
     * when nothing was targeting badges; when something was, say so plainly
     * rather than silently sending to the wrong (wider) audience.
     */
    if (insertError && /audience_badges/.test(insertError.message)) {
      if (badges.length > 0) {
        return {
          ok: false,
          message:
            "Badge targeting needs migration 0091 — run it, or clear the badge selection to send to tiers only.",
        };
      }
      ({ data: created, error: insertError } = await admin
        .from("announcements")
        .insert(base)
        .select("id")
        .single());
    }
    if (insertError || !created) {
      return { ok: false, message: insertError?.message ?? "Couldn't record the announcement." };
    }
    announcementId = created.id as string;
  }

  // Fan-out lives in lib/announcements-delivery.ts, shared with the cron
  // that fires scheduled announcements. Everything is journaled per member,
  // so a resume (another Send press) skips people already reached.
  const res = await deliverAnnouncement(announcementId);
  return {
    ok: res.ok,
    recipients: res.recipients,
    announcementId,
    message: res.message,
  };
}

/**
 * Admin: schedule an announcement for later (Matt, 2026-08-05 — Send Now
 * and Schedule live in the same composer). Records the announcement with
 * send_at set and sent_at NULL; the scheduled-posts cron delivers it when
 * due through the exact same fan-out as Send Now. Nothing is sent here.
 */
export async function scheduleAnnouncement(
  input: AnnouncementInput,
  sendAtIso: string,
): Promise<AnnouncementResult> {
  const communityOnly =
    input.channels.length > 0 &&
    input.channels.every((c) => c === "community");
  if (!input.title.trim()) {
    return { ok: false, message: "Give the announcement a title." };
  }
  if (input.channels.length === 0) {
    return { ok: false, message: "Pick at least one channel." };
  }
  if (
    input.audienceTiers.length === 0 &&
    (input.audienceBadges ?? []).length === 0 &&
    !communityOnly
  ) {
    return {
      ok: false,
      message:
        "Pick at least one audience tier or badge (or send to Community only — that channel reaches everyone).",
    };
  }
  const sendAt = new Date(sendAtIso);
  if (Number.isNaN(sendAt.getTime())) {
    return { ok: false, message: "Pick a valid date and time." };
  }
  if (sendAt.getTime() < Date.now() - 60_000) {
    return { ok: false, message: "That time is in the past — pick a future time or use Send now." };
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, preview: true, message: "Preview mode — nothing scheduled." };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message };

  const scheduleBadges = input.audienceBadges ?? [];
  const scheduleBase = {
    title: input.title.trim(),
    body: input.body.trim() || null,
    audience_tiers: input.audienceTiers,
    channels: input.channels,
    send_at: sendAt.toISOString(),
    sent_at: null,
    sent_by: auth.userId,
  };
  const client = createServiceClient();
  let { error } = await client
    .from("announcements")
    .insert({ ...scheduleBase, audience_badges: scheduleBadges });
  // Same pre-migration ladder as Send now.
  if (error && /audience_badges/.test(error.message)) {
    if (scheduleBadges.length > 0) {
      return {
        ok: false,
        message:
          "Badge targeting needs migration 0091 — run it, or clear the badge selection to schedule to tiers only.",
      };
    }
    ({ error } = await client.from("announcements").insert(scheduleBase));
  }
  if (error) {
    return {
      ok: false,
      message: /send_at/.test(error.message)
        ? "The database doesn't have the scheduled-announcements column yet — run migration 0075 first."
        : error.message,
    };
  }
  revalidatePath("/admin/announcements");
  return {
    ok: true,
    message: `Scheduled for ${formatAt(sendAt, "monthDayTime")} — it sends automatically through the same channels as Send now.`,
  };
}

/** Cancel a scheduled announcement that hasn't gone out yet. */
export async function cancelScheduledAnnouncement(
  id: string,
): Promise<AnnouncementResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Cancelled (preview mode)." };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message };
  const { error } = await createServiceClient()
    .from("announcements")
    .delete()
    .eq("id", id)
    .is("sent_at", null);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/announcements");
  return { ok: true, message: "Scheduled announcement cancelled." };
}

/*
 * Badge segments (Matt, 2026-08-19). Two things the composer needs that the
 * badge chips alone can't answer: how many people each badge actually
 * reaches, and a way to run the sync now rather than waiting for tonight's
 * cron after marking someone or shipping a change.
 */

export interface BadgeSegment {
  key: string;
  label: string;
  group: string;
  holders: number;
}

export async function badgeSegments(): Promise<BadgeSegment[]> {
  const { selectableBadges } = await import("@/lib/badges");
  const base = selectableBadges();
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return base.map((b) => ({ ...b, holders: 0 }));
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return [];
  const { badgeHolderCounts } = await import("@/lib/badge-sync");
  const counts = await badgeHolderCounts();
  return base.map((b) => ({ ...b, holders: counts[b.key] ?? 0 }));
}

/** Re-evaluate every member's badges now, then push what's owed to GHL. */
export async function runBadgeSync(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, message: "Preview mode — nothing synced." };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message ?? "Not allowed." };

  // Community counts first — the award step reads them (0094).
  const { syncCommunityCounts } = await import("@/lib/community-counts");
  const community = await syncCommunityCounts();

  const { syncMemberBadges } = await import("@/lib/badge-sync");
  const result = await syncMemberBadges();
  if (result.error) {
    return {
      ok: false,
      message: /member_badges/.test(result.error)
        ? "The badge table isn't there yet — run migration 0091."
        : `Sync failed: ${result.error}`,
    };
  }

  const { pushBadgeTags } = await import("@/lib/badge-ghl");
  const tags = await pushBadgeTags();
  revalidatePath("/admin/announcements");

  const communityNote = community.error
    ? ` Community messages skipped — ${community.error}.`
    : ` Counted ${community.messages} community message${community.messages === 1 ? "" : "s"}.`;
  const tagNote = tags.error
    ? ` GHL tags skipped — ${tags.error}.`
    : tags.tagged > 0
      ? ` Tagged ${tags.contacts} contact${tags.contacts === 1 ? "" : "s"} in GHL.`
      : "";
  return {
    ok: true,
    message:
      `Checked ${result.scanned} member${result.scanned === 1 ? "" : "s"}, ` +
      `${result.awarded} badge${result.awarded === 1 ? "" : "s"} newly earned.` +
      communityNote +
      tagNote,
  };
}
