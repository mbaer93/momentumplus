import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  alertEmailFailures,
  journalEmailEvents,
  type EmailEventRow,
  type NormalizedEmailEvent,
} from "@/lib/email-events";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * SendGrid Event Webhook: kept while SendGrid remains configured anywhere;
 * auth email has moved to Resend (see /api/webhooks/resend). Failures
 * alert every Super Admin; delivered/open land in the admin Email
 * Delivery page.
 *
 * Setup (SendGrid → Settings → Mail Settings → Event Webhook):
 *   URL: https://momentumplus.co/api/webhooks/sendgrid?token=<SENDGRID_WEBHOOK_TOKEN>
 *   Events: Delivered, Opened, Bounced, Blocked, Dropped, Spam Reports.
 */

const ALERT_EVENTS = new Set(["bounce", "blocked", "dropped", "spamreport"]);
const JOURNAL_EVENTS = new Set([...ALERT_EVENTS, "delivered", "open"]);

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.SENDGRID_WEBHOOK_TOKEN;
  if (!expected) return false;
  const got = req.nextUrl.searchParams.get("token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, note: "no database" });
  }
  if (!tokenOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let events: {
    email?: string;
    event?: string;
    reason?: string;
    response?: string;
    type?: string;
    timestamp?: number;
  }[];
  try {
    const body = (await req.json()) as unknown;
    events = Array.isArray(body) ? body : [];
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const rows: EmailEventRow[] = events
    .filter((e) => e.event && JOURNAL_EVENTS.has(e.event))
    .map((e) => ({
      email: String(e.email ?? "unknown").slice(0, 200),
      event: e.event as NormalizedEmailEvent,
      reason:
        String(e.reason ?? e.response ?? e.type ?? "").slice(0, 200) || null,
      occurred_at: new Date(
        (typeof e.timestamp === "number" ? e.timestamp : Date.now() / 1000) *
          1000,
      ).toISOString(),
    }));
  await journalEmailEvents(rows);

  const failures = rows
    .filter((r) => ALERT_EVENTS.has(r.event))
    .map((r) => ({ email: r.email, event: r.event, reason: r.reason ?? "" }));
  const emailed = await alertEmailFailures(failures, {
    name: "SendGrid",
    activityUrl: "https://app.sendgrid.com/email_activity",
    suppressionNote:
      "Blocked/bounced addresses stay suppressed until cleared: SendGrid &rarr; Suppressions. After clearing (or fixing a typo in Admin &rarr; Members), re-send the invite.",
  });

  return NextResponse.json({
    ok: true,
    failures: failures.length,
    journaled: rows.length,
    emailed,
  });
}
