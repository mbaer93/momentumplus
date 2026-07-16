import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getGhlContact } from "@/lib/ghl";
import { isGhlReady } from "@/lib/service-config";

/*
 * Nightly reconciliation (SPEC.md §4): repair drift between GHL and
 * `memberships` in case a webhook was missed.
 *
 * 1. Expiry sweep — any row whose access_expires_at has passed and whose
 *    status still implies access (active/past_due/canceled) flips to expired.
 *    This is what actually revokes access after the 7-day grace runs out.
 * 2. Drift check — for GHL-sourced rows expiring soon, confirm the GHL
 *    contact still exists; vanished contacts are reported for review (billing
 *    truth stays in GHL — we flag rather than guess).
 *
 * Protected by CRON_SECRET (Authorization: Bearer <CRON_SECRET>).
 */
export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  // 1. Expiry sweep.
  const { data: expired, error: sweepError } = await admin
    .from("memberships")
    .update({ status: "expired" })
    .in("status", ["active", "past_due", "canceled"])
    .not("access_expires_at", "is", null)
    .lt("access_expires_at", nowIso)
    .select("id");

  if (sweepError) {
    return NextResponse.json({ error: sweepError.message }, { status: 500 });
  }

  // 2. Drift check on rows expiring within 14 days (bounded per run).
  const missingContacts: string[] = [];
  const ghlReady = await isGhlReady();
  if (ghlReady) {
    const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates } = await admin
      .from("memberships")
      .select("id, ghl_contact_id")
      .eq("source", "ghl")
      .in("status", ["active", "past_due"])
      .not("ghl_contact_id", "is", null)
      .lte("access_expires_at", soon)
      .limit(100);

    for (const row of candidates ?? []) {
      const contact = await getGhlContact(row.ghl_contact_id!);
      if (!contact) missingContacts.push(row.ghl_contact_id!);
    }
  }

  return NextResponse.json({
    ok: true,
    expiredCount: expired?.length ?? 0,
    ghlChecked: ghlReady,
    missingContacts,
  });
}
