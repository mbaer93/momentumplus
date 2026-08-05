"use server";
import { revalidatePath } from "next/cache";

import { deliverAnnouncement } from "@/lib/announcements-delivery";
import { requireAdmin } from "@/lib/auth-helpers";
import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tier } from "@/lib/types";

export interface AnnouncementInput {
  title: string;
  body: string;
  audienceTiers: Tier[];
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
): Promise<{ count: number; smsCount: number }> {
  if (
    !isSupabaseConfigured() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    audienceTiers.length === 0
  ) {
    return { count: 0, smsCount: 0 };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { count: 0, smsCount: 0 };
  const admin = createServiceClient();
  const { rows } = await allRows<{
    profile_id: string;
    profiles: { phone: string | null } | null;
  }>((from, to) =>
    admin
      .from("memberships")
      .select("profile_id, profiles ( phone )")
      .in("tier", audienceTiers)
      .in("status", ["active", "past_due"])
      .order("profile_id")
      .range(from, to) as unknown as PromiseLike<{
      data:
        | { profile_id: string; profiles: { phone: string | null } | null }[]
        | null;
      error: { message: string } | null;
    }>,
  );
  const withPhone = new Set(
    rows.filter((r) => r.profiles?.phone).map((r) => r.profile_id),
  );
  const audienceIds = new Set(rows.map((r) => r.profile_id));
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
  if (input.audienceTiers.length === 0 && !communityOnly) {
    return {
      ok: false,
      message:
        "Pick at least one audience tier (or send to Community only — that channel reaches everyone).",
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
    const { data: created, error: insertError } = await admin
      .from("announcements")
      .insert({
        title: input.title.trim(),
        body: input.body.trim() || null,
        audience_tiers: input.audienceTiers,
        channels: input.channels,
        sent_at: new Date().toISOString(),
        sent_by: auth.userId,
      })
      .select("id")
      .single();
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
  if (input.audienceTiers.length === 0 && !communityOnly) {
    return {
      ok: false,
      message:
        "Pick at least one audience tier (or send to Community only — that channel reaches everyone).",
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

  const { error } = await createServiceClient().from("announcements").insert({
    title: input.title.trim(),
    body: input.body.trim() || null,
    audience_tiers: input.audienceTiers,
    channels: input.channels,
    send_at: sendAt.toISOString(),
    sent_at: null,
    sent_by: auth.userId,
  });
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
    message: `Scheduled for ${sendAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — it sends automatically through the same channels as Send now.`,
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
