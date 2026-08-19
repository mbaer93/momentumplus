import { NextResponse, type NextRequest } from "next/server";
import {
  alertEmailFailures,
  journalEmailEvents,
} from "@/lib/email-events";
import {
  resendEventRows,
  verifySvixSignature,
  type ResendPayload,
} from "@/lib/resend-webhook";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Resend webhook: auth emails (invites, password resets, login links) now
 * send through Resend's SMTP; Resend POSTs delivery events here. Failures
 * alert every Super Admin (bell + GHL email); delivered/opened land in the
 * admin Email Delivery page.
 *
 * Setup (Resend → Webhooks → Add endpoint):
 *   URL: https://momentumplus.co/api/webhooks/resend
 *   Events: email.delivered, email.opened, email.bounced, email.complained,
 *           email.failed
 *   Then put the endpoint's signing secret (whsec_…) in the
 *   RESEND_WEBHOOK_SECRET env var.
 *
 * Signature scheme is Svix: HMAC-SHA256 of "{id}.{timestamp}.{body}" with
 * the base64 secret; the svix-signature header carries space-separated
 * "v1,<base64>" candidates.
 */

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, note: "no database" });
  }
  const rawBody = await req.text();
  if (
    !verifySvixSignature(
      {
        id: req.headers.get("svix-id"),
        timestamp: req.headers.get("svix-timestamp"),
        signature: req.headers.get("svix-signature"),
      },
      rawBody,
      process.env.RESEND_WEBHOOK_SECRET,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ResendPayload;
  try {
    payload = JSON.parse(rawBody) as ResendPayload;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const rows = resendEventRows(payload);
  // An event type we do not track is Resend adding something, not a fault
  // worth a retry — 200, and say what was ignored.
  if (!rows) {
    return NextResponse.json({ ok: true, ignored: payload.type ?? "unknown" });
  }
  await journalEmailEvents(rows);

  let emailed = 0;
  const normalized = rows[0].event;
  if (normalized === "bounce" || normalized === "dropped" || normalized === "spamreport") {
    emailed = await alertEmailFailures(
      rows.map((r) => ({ email: r.email, event: r.event, reason: r.reason ?? "" })),
      {
        name: "Resend",
        activityUrl: "https://resend.com/emails",
        suppressionNote:
          "Bounced addresses may be suppressed by Resend until the address is fixed — check Resend &rarr; Emails for the delivery detail, correct the address in Admin &rarr; Members if it's a typo, and re-send the invite.",
      },
    );
  }
  return NextResponse.json({ ok: true, journaled: rows.length, emailed });
}
