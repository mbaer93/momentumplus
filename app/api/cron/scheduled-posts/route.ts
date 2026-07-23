import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { isStreamConfigured, sendCommunityMessage } from "@/lib/stream";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Posts due scheduled_posts into their community channel as "Momentum+
 * Team". Runs every 5 minutes; a post goes out once (sent_at set first so a
 * concurrent run can't double-post; rolled back if the send fails).
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
  if (!isStreamConfigured()) {
    // Posts stay pending until chat is connected — never lost.
    return NextResponse.json({ ok: true, skipped: "stream not configured" });
  }

  const admin = createServiceClient();
  const { data: due } = await admin
    .from("scheduled_posts")
    .select("id, channel, body")
    .is("sent_at", null)
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(10);

  const results: { id: string; status: string }[] = [];
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

  return NextResponse.json({ ok: true, processed: results });
}
