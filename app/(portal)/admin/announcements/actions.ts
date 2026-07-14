"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendEmailViaGhl } from "@/lib/notifications";
import type { Tier } from "@/lib/types";

export interface AnnouncementInput {
  title: string;
  body: string;
  audienceTiers: Tier[];
  channels: ("email" | "in_app")[]; // SMS announcements come later; opt-in only
}

export interface AnnouncementResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
  recipients?: number;
}

/**
 * Admin: send an announcement (SPEC.md §4). Records the announcement, fans
 * out in-app notifications to members in the audience tiers, and emails via
 * GHL when configured — always respecting each member's `platform` prefs.
 */
export async function sendAnnouncement(
  input: AnnouncementInput,
): Promise<AnnouncementResult> {
  if (!input.title.trim() || input.audienceTiers.length === 0) {
    return { ok: false, message: "Title and at least one audience tier required." };
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: true,
      preview: true,
      recipients: 0,
      message: "Preview mode — announcement recorded nowhere; connect Supabase to send.",
    };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();

  const { error: insertError } = await admin.from("announcements").insert({
    title: input.title.trim(),
    body: input.body.trim() || null,
    audience_tiers: input.audienceTiers,
    channels: input.channels,
    sent_at: new Date().toISOString(),
    sent_by: auth.userId,
  });
  if (insertError) return { ok: false, message: insertError.message };

  // Audience: members holding a usable membership in the selected tiers.
  const { data: memberships } = await admin
    .from("memberships")
    .select("profile_id, ghl_contact_id, profiles ( email, full_name )")
    .in("tier", input.audienceTiers)
    .in("status", ["active", "past_due"]);

  const seen = new Set<string>();
  let recipients = 0;

  for (const m of memberships ?? []) {
    if (seen.has(m.profile_id)) continue;
    seen.add(m.profile_id);
    const profile = (
      m as unknown as { profiles: { email: string; full_name: string } | null }
    ).profiles;
    if (!profile) continue;

    if (input.channels.includes("in_app")) {
      await admin.from("notifications").insert({
        profile_id: m.profile_id,
        kind: "announcement",
        title: input.title.trim(),
        body: input.body.trim() || null,
        link: "/dashboard",
      });
    }
    if (input.channels.includes("email")) {
      await sendEmailViaGhl({
        contactId: m.ghl_contact_id,
        email: profile.email,
        subject: input.title.trim(),
        html: `<p>Hi ${profile.full_name || "there"},</p><p>${(input.body || "").replace(/\n/g, "<br/>")}</p><p>— The Momentum+ team</p>`,
      });
    }
    recipients++;
  }

  return { ok: true, recipients, message: `Sent to ${recipients} member(s).` };
}
