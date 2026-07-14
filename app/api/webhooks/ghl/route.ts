import { NextResponse, type NextRequest } from "next/server";
import { verifyGhlWebhook } from "@/lib/ghl";
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
 *     "productId": "..."            // mapped via GHL_PRODUCT_TIER_MAP
 *     // or "tier": "sub_monthly" | "sub_3mo" | "sub_6mo" | "sub_annual"
 *   }
 * Common GHL event-name variants (InvoicePaid, subscription_cancelled, …)
 * are accepted too. Auth: x-ghl-signature (HMAC) or x-webhook-secret header.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const verified = verifyGhlWebhook(rawBody, {
    signature: req.headers.get("x-ghl-signature"),
    sharedSecret: req.headers.get("x-webhook-secret"),
  });
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

  // Find the member by email (auth user → profile). Payment for an unknown
  // email is parked: reconciliation or the TSLS import will pick them up, and
  // we respond 200 so GHL doesn't hammer retries for a member who signs up
  // minutes later.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", event.email)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({
      ok: true,
      skipped: `no profile for ${event.email}`,
    });
  }

  const tier = resolveTier(event, process.env.GHL_PRODUCT_TIER_MAP);
  if (event.kind === "payment_success" && !tier) {
    // Config gap — surface loudly in the response/logs but don't retry-spam.
    console.error(
      `[ghl] payment_success with unmapped product "${event.productId}" for ${event.email}`,
    );
    return NextResponse.json({
      ok: false,
      skipped: "unmapped product — set GHL_PRODUCT_TIER_MAP",
    });
  }

  // Current GHL-sourced membership for this member (latest row).
  const { data: existing } = await admin
    .from("memberships")
    .select("id, tier, status, access_starts_at, access_expires_at")
    .eq("profile_id", profile.id)
    .eq("source", "ghl")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const patch = applyGhlEvent(event, tier ?? existing?.tier ?? "sub_monthly", existing ?? null);

  const { error } = existing
    ? await admin.from("memberships").update(patch).eq("id", existing.id)
    : await admin
        .from("memberships")
        .insert({ ...patch, profile_id: profile.id });

  if (error) {
    // 500 → GHL retries, which is what we want for transient DB failures.
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
