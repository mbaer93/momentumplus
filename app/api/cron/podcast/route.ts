import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { bearerAuthorized } from "@/lib/db-utils";
import { recordCronRun } from "@/lib/cron-health";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { syncFromYoutube } from "@/lib/podcast";

/*
 * Branching Out sync (Matt, 2026-08-05): pull new episodes from the show's
 * YouTube channel feed so weekly uploads appear without any manual step.
 * Every 6 hours — a weekly show doesn't need tighter polling, and the admin
 * page has a "Sync now" button for immediacy.
 */
export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const result = await syncFromYoutube();
  if (result.ok) {
    if (result.added > 0) revalidatePath("/branching-out");
    await recordCronRun(
      "podcast",
      `${result.added} new / ${result.seen} in feed`,
    );
    return NextResponse.json(result);
  }
  // "No channel configured" is a setup state, not a failure — heartbeat it
  // so Admin → Connections shows the cron alive either way.
  if (result.message === "No channel configured") {
    await recordCronRun("podcast", "waiting for channel id");
    return NextResponse.json(result);
  }
  return NextResponse.json(result, { status: 502 });
}
