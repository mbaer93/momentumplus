import { bearerAuthorized, redactEmail } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { recordCronRun } from "@/lib/cron-health";
import {
  activateScheduledGift,
  type ScheduledGiftRow,
} from "@/lib/onboarding";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Scheduled-gift activation (Matt, 2026-07-30). Gifts are set up the moment
 * a TSLS ticket purchase reaches the system, but the free months start in
 * the MONTH OF THE EVENT — they wait in scheduled_gifts until then. Daily,
 * this applies every pending gift whose start date has arrived: paying
 * members get the Stripe billing pause (+ email), everyone else gets the
 * membership row anchored on the scheduled start. Failures stay unstamped
 * and retry tomorrow.
 */

const BATCH = 100;

// Each activation is a serial chain (memberships read, maybe Stripe pause,
// GHL email, audit write) — realistically 1-3s. Without these two guards a
// 2,500-gift event morning would time out partway on the default budget and
// drain over weeks instead of days.
export const maxDuration = 300;
const TIME_BUDGET_MS = 240_000;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("scheduled_gifts")
    .select("id, profile_id, email, name, tier, months, starts_at, source")
    .is("applied_at", null)
    .lte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return NextResponse.json(
      {
        error: /relation .*scheduled_gifts.* does not exist/i.test(error.message)
          ? "Run migration 0068 first."
          : error.message,
      },
      { status: 500 },
    );
  }

  let applied = 0;
  let deferred = 0;
  const failures: string[] = [];
  for (const row of rows ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Out of time — the rest stays pending and the next run continues.
      deferred++;
      continue;
    }
    // One throwing row (Stripe 5xx, GHL outage) must not abort the whole
    // batch — record it and keep draining; unstamped rows retry tomorrow.
    const res = await activateScheduledGift(
      row as unknown as ScheduledGiftRow,
    ).catch((e) => ({ ok: false, result: (e as Error).message || "threw" }));
    if (res.ok) {
      await admin
        .from("scheduled_gifts")
        .update({ applied_at: new Date().toISOString(), result: res.result })
        .eq("id", row.id);
      applied++;
    } else {
      // Leave unstamped so tomorrow retries; keep the reason visible.
      await admin
        .from("scheduled_gifts")
        .update({ result: `retrying: ${res.result}` })
        .eq("id", row.id);
      failures.push(`${redactEmail(String(row.email))}: ${res.result}`);
    }
  }

  await recordCronRun("gift-activate");
  return NextResponse.json({ ok: true, applied, deferred, failures });
}
