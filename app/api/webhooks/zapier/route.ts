import { NextResponse, type NextRequest } from "next/server";
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
 * plan accepts: monthly, 3month, 6month, 12month/annual, attendee, vip,
 * speaker. New members get a Supabase invite email that lands on /welcome
 * to set their password; repeats are idempotent (no double-grants).
 */

const ALLOWED_TIERS: Tier[] = [
  "tsls_attendee",
  "tsls_vip",
  "sub_monthly",
  "sub_3mo",
  "sub_6mo",
  "sub_annual",
  "speaker",
];

function authorized(req: NextRequest): boolean {
  const secret = process.env.ZAPIER_WEBHOOK_SECRET;
  if (!secret) return false;
  const key =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return key === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
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
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const mapping = planToTier(plan);
  if (!mapping || !ALLOWED_TIERS.includes(mapping.tier)) {
    return NextResponse.json(
      {
        error: `Unknown plan "${plan}". Use one of: monthly, 3month, 6month, 12month, annual, attendee, vip, speaker.`,
      },
      { status: 400 },
    );
  }

  const result = await provisionMember({
    email,
    name,
    tier: mapping.tier,
    months: mapping.months,
    source: "zapier",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}

/** Connection test: confirms the endpoint + key work without creating anyone. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    usage:
      'POST JSON {"email","name","plan"} with header x-api-key. Plans: monthly, 3month, 6month, 12month, annual, attendee, vip, speaker.',
  });
}
