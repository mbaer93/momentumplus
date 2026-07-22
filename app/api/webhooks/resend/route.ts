import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  alertEmailFailures,
  journalEmailEvents,
  type EmailEventRow,
  type NormalizedEmailEvent,
} from "@/lib/email-events";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Resend webhook: auth emails (invites, password resets, login links) now
 * send through Resend's SMTP; Resend POSTs delivery events here. Failures
 * alert every Super Admin (bell + GHL email); delivered/opened land in the
 * admin Email Delivery page. Mirrors /api/webhooks/sendgrid, which stays
 * for as long as SendGrid remains configured anywhere.
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

const EVENT_MAP: Record<string, NormalizedEmailEvent> = {
  "email.delivered": "delivered",
  "email.opened": "open",
  "email.bounced": "bounce",
  "email.complained": "spamreport",
  "email.failed": "dropped",
};

const TOLERANCE_MS = 5 * 60 * 1000;

function verifySvix(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  // Replay guard: reject stale timestamps.
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOLERANCE_MS) {
    return false;
  }
  const key = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64",
  );
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();
  return signatures.split(" ").some((candidate) => {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) return false;
    try {
      const got = Buffer.from(sig, "base64");
      return got.length === expected.length && timingSafeEqual(got, expected);
    } catch {
      return false;
    }
  });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, note: "no database" });
  }
  const rawBody = await req.text();
  if (!verifySvix(req, rawBody)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    type?: string;
    created_at?: string;
    data?: {
      to?: string | string[];
      subject?: string;
      bounce?: { message?: string; subType?: string };
      failed?: { reason?: string };
    };
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const normalized = payload.type ? EVENT_MAP[payload.type] : undefined;
  if (!normalized) {
    return NextResponse.json({ ok: true, ignored: payload.type ?? "unknown" });
  }

  const recipients = Array.isArray(payload.data?.to)
    ? payload.data.to
    : payload.data?.to
      ? [payload.data.to]
      : ["unknown"];
  const reason =
    payload.data?.bounce?.message ??
    payload.data?.failed?.reason ??
    payload.data?.bounce?.subType ??
    "";
  const occurredAt = payload.created_at
    ? new Date(payload.created_at).toISOString()
    : new Date().toISOString();

  const rows: EmailEventRow[] = recipients.map((to) => ({
    email: String(to).slice(0, 200),
    event: normalized,
    reason: reason ? String(reason).slice(0, 200) : null,
    occurred_at: occurredAt,
  }));
  await journalEmailEvents(rows);

  let emailed = 0;
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
