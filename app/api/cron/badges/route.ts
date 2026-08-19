import { NextResponse, type NextRequest } from "next/server";
import { bearerAuthorized } from "@/lib/db-utils";
import { recordCronRun } from "@/lib/cron-health";
import { syncMemberBadges } from "@/lib/badge-sync";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Nightly badge sync (migration 0091).
 *
 * Re-evaluates every member with a membership and writes down anything
 * newly earned. Append-only and idempotent, so a re-fire is harmless and a
 * run that dies partway is simply finished by the next one.
 *
 * Nightly rather than on-write: a badge is not time-critical (nobody needs
 * "In the Room · Bronze" the second a session ends), and hanging a fan-out
 * off every attendance mark, note save, and lesson completion would put a
 * write amplification on the hottest paths in the app for a decoration.
 * Anything that DOES need to be immediate — an offer gate at checkout —
 * should read the live counts, not wait for this.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  /*
   * Community counts FIRST — the badge award below reads them, so pulling
   * after would award every member last night's conversation.
   */
  const { syncCommunityCounts } = await import("@/lib/community-counts");
  const community = await syncCommunityCounts();

  const result = await syncMemberBadges();

  /*
   * Then push what is owed to GHL as contact tags (0092), so offers can be
   * built against badges where campaigns already live. Runs even when the
   * award step errored: the tag queue is journaled per row and may hold
   * work from earlier runs that has nothing to do with tonight's counts.
   */
  const { pushBadgeTags } = await import("@/lib/badge-ghl");
  const tags = await pushBadgeTags();

  await recordCronRun(
    "badges",
    result.error
      ? `failed: ${result.error}`
      : `${result.scanned} members, ${result.awarded} newly earned` +
          (community.error
            ? ` · community skipped (${community.error})`
            : ` · ${community.messages} messages from ${community.members}` +
              (community.truncated.length
                ? ` (capped: ${community.truncated.join(", ")})`
                : "")) +
          (tags.error
            ? ` · tags skipped (${tags.error})`
            : ` · ${tags.tagged} tags to ${tags.contacts} contacts` +
              (tags.failed ? `, ${tags.failed} failed` : "")),
  );

  return NextResponse.json(
    {
      ok: !result.error,
      scanned: result.scanned,
      awarded: result.awarded,
      newByKey: result.newByKey,
      community,
      ghlTags: tags,
      ...(result.error ? { error: result.error } : {}),
    },
    { status: result.error ? 500 : 200 },
  );
}
