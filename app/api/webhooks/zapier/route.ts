import { NextResponse, type NextRequest } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge-auth";
import { planToTier, provisionMember } from "@/lib/onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tier } from "@/lib/types";

/*
 * Inbound member-provisioning webhook for Zapier (or any tool that can POST
 * JSON). Point a "Webhooks by Zapier" action here whenever a new member
 * should get access — e.g. after a GHL purchase, a form submission, or a
 * spreadsheet row.
 *
 *   POST /api/webhooks/zapier
 *   Header:  x-api-key: <ZAPIER_WEBHOOK_SECRET>
 *   Body:    { "email": "...", "name": "...", "plan": "monthly" }
 *
 * plan accepts: basic, gift, vip, pro, monthly, 3month, 6month,
 * 12month/annual, attendee, tslsvip, speaker. New members get a Supabase invite email that lands on /welcome
 * to set their password; repeats are idempotent (no double-grants).
 */

const ALLOWED_TIERS: Tier[] = [
  "tsls_attendee",
  "tsls_vip",
  "sub_monthly",
  "sub_3mo",
  "sub_6mo",
  "sub_annual",
  "basic",
  "gift",
  "vip",
  "pro",
  "speaker",
  "sponsor",
];

// bridgeAuthorized accepts MOMENTUM_BRIDGE_KEY *or* ZAPIER_WEBHOOK_SECRET —
// the same dual check as /api/bridge/*. This route previously accepted only
// the Zapier secret, so configuring the documented "preferred" bridge key
// alone made every TSLS attendee provisioning silently 401.

export async function POST(req: NextRequest) {
  if (!bridgeAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const name = typeof body.name === "string" ? body.name : "";
  const plan = typeof body.plan === "string" ? body.plan : "";
  // quiet=true creates the account without a Momentum+ email — used by the
  // TSLS Companion bridge, which sends the single invite and crosses members
  // over via SSO. Defaults to the normal invite-email behaviour.
  const quiet = body.quiet === true || body.quiet === "true";
  // startAt (ISO, gift plans only): a future date creates the account now
  // but holds the gift until then — TSLS sends the first of the event month
  // so the free months start with the event, not the ticket purchase.
  const startAt = typeof body.startAt === "string" ? body.startAt : null;
  /*
   * isTester: create this account as a TEST account — full tier access,
   * hidden from every member-facing list (Matt, 2026-08-14). TSLS sends it
   * when Matt marks someone a tester there, so one action on his side
   * produces a matching hidden member here.
   *
   * Set-only, by design: provisionMember never clears the flag, so a later
   * ordinary grant for the same person cannot quietly reveal a test account.
   * Unmarking is an admin action in Admin → Members.
   */
  const isTester = body.isTester === true || body.isTester === "true";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const mapping = planToTier(plan);
  if (!mapping || !ALLOWED_TIERS.includes(mapping.tier)) {
    return NextResponse.json(
      {
        error: `Unknown plan "${plan}". Use one of: basic, gift, vip, pro, monthly, 3month, 6month, 12month, annual, attendee, speaker.`,
      },
      { status: 400 },
    );
  }

  /*
   * Speaker/sponsor grants ride the season clocks, never "forever": a null
   * expiry here minted permanent Pro-level access that the Oct 1 / Apr 1
   * expiries could not touch (and that the real onboarding flows couldn't
   * see, because they look for their own source values).
   *
   * seasonEnd, NOT nextOctoberFirst (2026-08-18): speakers get the season
   * (Matt: "full VIP access through the end of the season"), and the
   * season containing a mid-October summit ends October 1 of the FOLLOWING
   * year — the same clock the speaker-onboarding flows already use. The
   * nearest-Oct-1 clock this branch used expired 8 bridge-provisioned 2026
   * speakers on 2026-10-01, thirteen days BEFORE the summit they were
   * speaking at.
   */
  let accessExpiresAt: string | undefined;
  if (mapping.tier === "speaker" || mapping.tier === "sponsor") {
    const { seasonEnd, sponsorTermEnd } = await import(
      "@/lib/sponsor-lifecycle"
    );
    accessExpiresAt =
      mapping.tier === "speaker"
        ? seasonEnd().toISOString()
        : sponsorTermEnd().toISOString();
  }

  const result = await provisionMember({
    email,
    name,
    tier: mapping.tier,
    months: mapping.months,
    source: "zapier",
    quiet,
    startAt,
    tester: isTester,
    ...(accessExpiresAt !== undefined ? { accessExpiresAt } : {}),
  });

  // Never echo the one-time login link into the webhook response — it would
  // land in Zapier's task history (readable by any Zap collaborator) as a
  // live account-takeover token. If the invite email failed, the admin
  // issues a link from Admin → Members instead.
  return NextResponse.json(
    {
      ok: result.ok,
      email: result.email,
      invited: result.invited,
      alreadyActive: result.alreadyActive,
      message: result.message,
      emailSent: result.invited && !result.loginLink,
    },
    { status: result.ok ? 200 : 422 },
  );
}

/** Connection test: confirms the endpoint + key work without creating anyone. */
export async function GET(req: NextRequest) {
  if (!bridgeAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    usage:
      'POST JSON {"email","name","plan"} with header x-api-key. Plans: basic, gift, vip, pro, monthly, 3month, 6month, 12month, annual, attendee, speaker.',
  });
}
