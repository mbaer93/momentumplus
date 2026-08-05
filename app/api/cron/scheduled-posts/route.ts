import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { deliverAnnouncement } from "@/lib/announcements-delivery";
import { recordCronRun } from "@/lib/cron-health";
import { isStreamConfigured, sendCommunityMessage } from "@/lib/stream";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Fires everything scheduled, every 5 minutes:
 *
 * 1. Scheduled ANNOUNCEMENTS (migration 0075): announcements rows with
 *    send_at due and sent_at NULL, delivered through the same fan-out as
 *    the composer's Send Now (community, in-app + push, email, SMS).
 *    Delivery is journaled per member, so a run that hits the time budget
 *    leaves sent_at NULL and the next run resumes where it stopped —
 *    nobody is messaged twice. sent_at is stamped once a run completes.
 *
 * 2. Legacy scheduled_posts (chat-only): a post goes out once (sent_at set
 *    first so a concurrent run can't double-post; rolled back if the send
 *    fails). The admin UI no longer creates these, but anything already
 *    queued still fires.
 */
// Long-running under load — allow the full function window (Vercel Pro).
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();
  const results: { id: string; status: string }[] = [];

  // --- Scheduled announcements (full fan-out, resumable) -----------------
  // One per run: delivery is time-budgeted (~240s) and two large sends
  // can't share a 300s window. The next run picks up the next one.
  const { data: dueAnnouncements, error: annError } = await admin
    .from("announcements")
    .select("id")
    .is("sent_at", null)
    .not("send_at", "is", null)
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(1);
  // Pre-migration-0075 databases have no send_at column — skip quietly.
  if (!annError) {
    for (const ann of dueAnnouncements ?? []) {
      const res = await deliverAnnouncement(ann.id as string);
      if (res.complete) {
        await admin
          .from("announcements")
          .update({ sent_at: new Date().toISOString() })
          .eq("id", ann.id)
          .is("sent_at", null);
      }
      results.push({
        id: ann.id as string,
        status: res.complete
          ? `announcement sent — ${res.message}`
          : `announcement partial (resumes next run) — ${res.message}`,
      });
    }
  }

  // --- Legacy chat-only scheduled posts ----------------------------------
  if (isStreamConfigured()) {
    const { data: due } = await admin
      .from("scheduled_posts")
      .select("id, channel, body")
      .is("sent_at", null)
      .lte("send_at", new Date().toISOString())
      .order("send_at")
      .limit(10);

    for (const post of due ?? []) {
      // Claim first so overlapping runs can't double-post.
      const { data: claimed } = await admin
        .from("scheduled_posts")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", post.id)
        .is("sent_at", null)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        await sendCommunityMessage(post.channel, post.body);
        results.push({ id: post.id, status: "sent" });
      } catch (e) {
        // Release the claim so the next run retries.
        await admin
          .from("scheduled_posts")
          .update({ sent_at: null })
          .eq("id", post.id);
        results.push({ id: post.id, status: `error: ${(e as Error).message}` });
      }
    }
  }

  await recordCronRun("scheduled-posts");
  return NextResponse.json({ ok: true, processed: results });
}
