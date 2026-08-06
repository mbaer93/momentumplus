import { createHash } from "node:crypto";
import { emailPattern, redactEmail } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { verifyGhlWebhook } from "@/lib/ghl";
import { getGhlCreds } from "@/lib/service-config";
import {
  applyGhlEvent,
  normalizeGhlEvent,
  resolveTier,
} from "@/lib/membership";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * GHL webhook → memberships (SPEC.md §4). GHL is the source of truth for
 * payment status; this route is the only writer of ghl-sourced memberships
 * outside nightly reconciliation.
 *
 * Expected JSON body (configure the GHL workflow's Custom Webhook action):
 *   {
 *     "type": "payment_success" | "payment_failed" | "cancel",
 *     "contactId": "...", "email": "...", "name": "...",
 *     "productId": "...",           // mapped via GHL_PRODUCT_TIER_MAP
 *     // or "tier": "sub_monthly" | "sub_3mo" | "sub_6mo" | "sub_annual"
 *     "invoiceId": "..."            // OPTIONAL but recommended: any unique
 *                                   // per-payment id (invoiceId /
 *                                   // transactionId / eventId) makes
 *                                   // duplicate deliveries exactly-once
 *   }
 * Common GHL event-name variants (InvoicePaid, subscription_cancelled, …)
 * are accepted too. Auth: x-ghl-signature (HMAC) or x-webhook-secret header.
 *
 * Idempotency (audit 2026-08-06 P0-2): payment_success extends expiry, so a
 * redelivered event must not stack months. Each delivery is claimed in
 * ghl_webhook_events before it's applied — by unique id when the payload
 * carries one (deduped forever), else by a hash of the raw body (deduped
 * within BODY_DEDUPE_WINDOW_MS, since a templated workflow can send an
 * identical body for next month's legitimate renewal).
 */

const BODY_DEDUPE_WINDOW_MS = 48 * 60 * 60 * 1000;
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const { webhookSecret } = await getGhlCreds();
  const verified = verifyGhlWebhook(
    rawBody,
    {
      signature: req.headers.get("x-ghl-signature"),
      sharedSecret: req.headers.get("x-webhook-secret"),
    },
    webhookSecret ?? undefined,
  );
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = normalizeGhlEvent(payload);
  if (!event) {
    // Not an event we handle — 200 so GHL doesn't retry forever.
    return NextResponse.json({ ok: true, skipped: "unrecognized event" });
  }

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const admin = createServiceClient();

  // -------------------------------------------------------------------------
  // Duplicate-delivery claim. Must happen before any membership write.
  // -------------------------------------------------------------------------
  const dedupeKey = event.eventId
    ? `id:${event.eventId}`
    : `body:${createHash("sha256").update(rawBody).digest("hex")}`;
  const permanentKey = Boolean(event.eventId);

  const { data: seen, error: seenError } = await admin
    .from("ghl_webhook_events")
    .select("id, received_at")
    .eq("id", dedupeKey)
    .maybeSingle();
  if (seenError) {
    // Can't verify uniqueness → don't apply. 500 → GHL redelivers later.
    return NextResponse.json({ error: seenError.message }, { status: 500 });
  }
  if (seen) {
    const ageMs = Date.now() - new Date(seen.received_at as string).getTime();
    if (permanentKey || ageMs < BODY_DEDUPE_WINDOW_MS) {
      return NextResponse.json({ ok: true, skipped: "duplicate delivery" });
    }
    // Same body but outside the retry window — treat as a fresh event (a
    // templated workflow re-sending identical JSON for a new billing cycle).
    const { error: touchError } = await admin
      .from("ghl_webhook_events")
      .update({ kind: event.kind, received_at: new Date().toISOString() })
      .eq("id", dedupeKey);
    if (touchError) {
      return NextResponse.json({ error: touchError.message }, { status: 500 });
    }
  } else {
    const { error: claimError } = await admin
      .from("ghl_webhook_events")
      .insert({ id: dedupeKey, kind: event.kind });
    if (claimError) {
      // 23505 = another concurrent delivery of the same event won the claim.
      if (claimError.code === "23505") {
        return NextResponse.json({ ok: true, skipped: "duplicate delivery" });
      }
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }
  }
  /** Undo the claim when the event wasn't applied, so GHL's retry of a
      transient failure isn't misread as a duplicate. Best-effort. */
  const releaseClaim = async () => {
    await admin.from("ghl_webhook_events").delete().eq("id", dedupeKey);
  };

  // Find the member by email (auth user → profile). Payment for an unknown
  // email is parked: reconciliation or the TSLS import will pick them up, and
  // we respond 200 so GHL doesn't hammer retries for a member who signs up
  // minutes later.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", emailPattern(event.email))
    .maybeSingle();
  if (profileError) {
    // A lookup failure is NOT "no profile" — answering 200 here would tell
    // GHL the payment was handled when nothing was written.
    await releaseClaim();
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile) {
    // Parked, not applied — release the claim so a manual re-send after the
    // member signs up isn't swallowed as a duplicate.
    await releaseClaim();
    return NextResponse.json({
      ok: true,
      skipped: `no profile for ${redactEmail(event.email)}`,
    });
  }

  const tier = resolveTier(event, process.env.GHL_PRODUCT_TIER_MAP);
  if (event.kind === "payment_success" && !tier) {
    // Config gap — surface loudly in the response/logs but don't retry-spam.
    console.error(
      `[ghl] payment_success with unmapped product "${event.productId}" for ${redactEmail(event.email)}`,
    );
    // Not applied — release so a re-send after fixing the map goes through.
    await releaseClaim();
    return NextResponse.json({
      ok: false,
      skipped: "unmapped product — set GHL_PRODUCT_TIER_MAP",
    });
  }

  // Current GHL-sourced membership for this member (latest row).
  const { data: existing, error: existingError } = await admin
    .from("memberships")
    .select("id, tier, status, access_starts_at, access_expires_at")
    .eq("profile_id", profile.id)
    .eq("source", "ghl")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    // Proceeding as if no row exists would insert a duplicate membership
    // and mis-stack the expiry — fail and let GHL retry.
    await releaseClaim();
    return NextResponse.json(
      { error: existingError.message },
      { status: 500 },
    );
  }

  // A failed or canceled payment for someone with NO membership row must
  // not create one — inserting the past_due patch would hand a declined
  // first payment 7 days of free access on a guessed tier.
  if (!existing && event.kind !== "payment_success") {
    return NextResponse.json({
      ok: true,
      skipped: `${event.kind} for ${redactEmail(event.email)} with no existing membership`,
    });
  }

  const patch = applyGhlEvent(event, tier ?? existing?.tier ?? "sub_monthly", existing ?? null);

  const { error } = existing
    ? await admin.from("memberships").update(patch).eq("id", existing.id)
    : await admin
        .from("memberships")
        .insert({ ...patch, profile_id: profile.id });

  if (error) {
    // 500 → GHL retries, which is what we want for transient DB failures.
    // Release the claim so that retry isn't skipped as a duplicate.
    await releaseClaim();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    applied: event.kind,
    tier: patch.tier,
    status: patch.status,
    access_expires_at: patch.access_expires_at,
  });
}
