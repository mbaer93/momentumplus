"use server";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendEmailViaGhl } from "@/lib/notifications";
import type { Tier } from "@/lib/types";

export interface AnnouncementInput {
  title: string;
  body: string;
  audienceTiers: Tier[];
  /** SMS announcements come later; opt-in only. "community" posts to the
      #announcements chat channel (all members, tiers don't apply). */
  channels: ("email" | "in_app" | "community")[];
}

export interface AnnouncementResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
  recipients?: number;
  /** Set when a send stopped partway — pass back to resume safely. */
  announcementId?: string;
}

/** How many members the selected tiers reach — shown in the confirm step. */
export async function previewAnnouncementAudience(
  audienceTiers: Tier[],
): Promise<{ count: number }> {
  if (
    !isSupabaseConfigured() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    audienceTiers.length === 0
  ) {
    return { count: 0 };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { count: 0 };
  const admin = createServiceClient();
  const { data } = await admin
    .from("memberships")
    .select("profile_id")
    .in("tier", audienceTiers)
    .in("status", ["active", "past_due"]);
  return { count: new Set((data ?? []).map((r) => r.profile_id)).size };
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

  // Community post: into the #announcements chat channel as the team user.
  let communityNote = "";
  if (input.channels.includes("community")) {
    try {
      const { sendCommunityMessage } = await import("@/lib/stream");
      await sendCommunityMessage(
        "announcements",
        `${input.title.trim()}${input.body.trim() ? `\n\n${input.body.trim()}` : ""}`,
      );
      communityNote = " Posted to #announcements.";
    } catch (e) {
      communityNote = ` Community post failed (${(e as Error).message}) — send it again with only the Community channel selected to retry.`;
    }
  }
  if (input.audienceTiers.length === 0) {
    return {
      ok: !communityNote.includes("failed"),
      recipients: 0,
      announcementId,
      message: communityNote.trim() || "Nothing sent.",
    };
  }

  // Audience: members holding a usable membership in the selected tiers.
  const { data: memberships } = await admin
    .from("memberships")
    .select("profile_id, ghl_contact_id, profiles ( email, full_name )")
    .in("tier", input.audienceTiers)
    .in("status", ["active", "past_due"]);

  const seen = new Set<string>();
  const audience: {
    profileId: string;
    contactId: string | null;
    email: string;
    name: string;
  }[] = [];
  for (const m of memberships ?? []) {
    if (seen.has(m.profile_id)) continue;
    seen.add(m.profile_id);
    const profile = (
      m as unknown as { profiles: { email: string; full_name: string } | null }
    ).profiles;
    if (!profile) continue;
    audience.push({
      profileId: m.profile_id as string,
      contactId: (m.ghl_contact_id as string) ?? null,
      email: profile.email,
      name: profile.full_name,
    });
  }
  const profileIds = audience.map((a) => a.profileId);

  // What already went out (retry safety). Pre-migration the table may not
  // exist — treat as "nothing delivered yet" and skip journaling.
  let delivered = new Map<string, { notified: boolean; emailed: boolean }>();
  let ledgerAvailable = true;
  {
    const { data: rows, error } = await admin
      .from("announcement_deliveries")
      .select("profile_id, notified_at, emailed_at")
      .eq("announcement_id", announcementId);
    if (error) {
      ledgerAvailable = false;
    } else {
      delivered = new Map(
        (rows ?? []).map((r) => [
          r.profile_id as string,
          { notified: Boolean(r.notified_at), emailed: Boolean(r.emailed_at) },
        ]),
      );
    }
  }

  // Platform prefs in ONE query (was one query per member).
  const optedOut = new Set<string>();
  if (input.channels.includes("in_app") && profileIds.length > 0) {
    const { data: prefs } = await admin
      .from("notification_prefs")
      .select("profile_id, in_app")
      .eq("key", "platform")
      .in("profile_id", profileIds);
    for (const p of prefs ?? []) {
      if (p.in_app === false) optedOut.add(p.profile_id as string);
    }
  }

  // In-app rows: one bulk insert for everyone still owed one.
  if (input.channels.includes("in_app")) {
    const owed = audience.filter(
      (a) => !optedOut.has(a.profileId) && !delivered.get(a.profileId)?.notified,
    );
    if (owed.length > 0) {
      await admin.from("notifications").insert(
        owed.map((a) => ({
          profile_id: a.profileId,
          kind: "announcement",
          title: input.title.trim(),
          body: input.body.trim() || null,
          link: "/dashboard",
        })),
      );
      if (ledgerAvailable) {
        await admin.from("announcement_deliveries").upsert(
          owed.map((a) => ({
            announcement_id: announcementId,
            profile_id: a.profileId,
            notified_at: new Date().toISOString(),
          })),
          { onConflict: "announcement_id,profile_id" },
        );
      }
    }
  }

  // Emails: sequential (GHL API), journaled one by one so a mid-loop crash
  // never double-sends on retry.
  let emailed = 0;
  let emailFailures = 0;
  if (input.channels.includes("email")) {
    for (const a of audience) {
      if (delivered.get(a.profileId)?.emailed) continue;
      const res = await sendEmailViaGhl({
        contactId: a.contactId,
        email: a.email,
        subject: input.title.trim(),
        html: `<p>Hi ${a.name || "there"},</p><p>${(input.body || "").replace(/\n/g, "<br/>")}</p><p>— The Momentum+ team</p>`,
      });
      if (res.sent) {
        emailed++;
        if (ledgerAvailable) {
          // On conflict only the provided columns update — notified_at stays.
          await admin.from("announcement_deliveries").upsert(
            {
              announcement_id: announcementId,
              profile_id: a.profileId,
              emailed_at: new Date().toISOString(),
            },
            { onConflict: "announcement_id,profile_id" },
          );
        }
      } else if (res.reason !== "no GHL contact id" && res.reason !== "GHL not configured") {
        emailFailures++;
      }
    }
  }

  const parts: string[] = [`Reached ${audience.length} member${audience.length === 1 ? "" : "s"}.`];
  if (input.channels.includes("email")) {
    parts.push(`${emailed} email${emailed === 1 ? "" : "s"} sent this run.`);
    if (emailFailures > 0) {
      parts.push(
        `${emailFailures} email${emailFailures === 1 ? "" : "s"} failed — press Send again to retry just those (no one gets duplicates).`,
      );
    }
  }
  return {
    ok: emailFailures === 0,
    recipients: audience.length,
    announcementId,
    message: parts.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Scheduled community posts: written now, posted to chat later by the cron.
// ---------------------------------------------------------------------------

export interface ScheduledPostInput {
  channel: string;
  body: string;
  /** ISO timestamp for when the post should go out. */
  sendAt: string;
}

async function scheduledGuard(): Promise<AnnouncementResult | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message };
  return null;
}

function validScheduledInput(input: ScheduledPostInput): string | null {
  if (!input.body.trim()) return "Write the post first.";
  const at = new Date(input.sendAt);
  if (Number.isNaN(at.getTime())) return "Pick a valid date and time.";
  if (at.getTime() < Date.now() - 60_000) {
    return "That time is in the past — pick a future date and time.";
  }
  return null;
}

export async function createScheduledPost(
  input: ScheduledPostInput,
): Promise<AnnouncementResult> {
  const early = await scheduledGuard();
  if (early) return early;
  const bad = validScheduledInput(input);
  if (bad) return { ok: false, message: bad };

  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message };
  const { error } = await createServiceClient().from("scheduled_posts").insert({
    channel: input.channel,
    body: input.body.trim(),
    send_at: new Date(input.sendAt).toISOString(),
    created_by: auth.userId,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/announcements");
  return { ok: true, message: "Post scheduled." };
}

export async function updateScheduledPost(
  id: string,
  input: ScheduledPostInput,
): Promise<AnnouncementResult> {
  const early = await scheduledGuard();
  if (early) return early;
  const bad = validScheduledInput(input);
  if (bad) return { ok: false, message: bad };

  const admin = createServiceClient();
  const { data: row } = await admin
    .from("scheduled_posts")
    .select("sent_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, message: "Scheduled post not found." };
  if (row.sent_at) return { ok: false, message: "That post already went out." };

  const { error } = await admin
    .from("scheduled_posts")
    .update({
      channel: input.channel,
      body: input.body.trim(),
      send_at: new Date(input.sendAt).toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/announcements");
  return { ok: true, message: "Scheduled post updated." };
}

export async function deleteScheduledPost(
  id: string,
): Promise<AnnouncementResult> {
  const early = await scheduledGuard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("scheduled_posts")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/announcements");
  return { ok: true, message: "Scheduled post deleted." };
}
