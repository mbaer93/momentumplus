import { NextResponse, type NextRequest } from "next/server";
import { emailPattern } from "@/lib/db-utils";
import { requestSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * SSO handoff for a trusted first-party app (the TSLS Companion).
 *
 * The two apps run on separate Supabase projects, so there is no shared
 * session. This endpoint lets TSLS — which already knows the member's
 * verified email from their TSLS session — exchange a shared secret for a
 * one-time Momentum+ login URL, so the member crosses over with a single
 * click and no second sign-in.
 *
 *   POST /api/sso/handoff
 *   Header: x-api-key: <SSO_HANDOFF_SECRET>
 *   Body:   { "email": "...", "redirect": "/dashboard" }
 *   → 200 { ok: true, url }   (a short-lived, single-use magic link)
 *
 * A link is only ever minted for an email that ALREADY has a Momentum+
 * account — this endpoint never creates members (provisioning is separate).
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.SSO_HANDOFF_SECRET;
  if (!secret) return false;
  const key =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const { timingSafeEqual, createHash } = require("crypto") as typeof import("crypto");
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
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

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // Same-origin landing path only — never an outside host.
  const redirectRaw = typeof body.redirect === "string" ? body.redirect : "";
  const redirect =
    redirectRaw.startsWith("/") && !redirectRaw.startsWith("//")
      ? redirectRaw
      : "/dashboard";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", emailPattern(email))
    .maybeSingle();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "No Momentum+ account for that email." },
      { status: 404 },
    );
  }

  const siteUrl = requestSiteUrl();
  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=${encodeURIComponent(redirect)}`
        : undefined,
    },
  });
  if (error || !linkData) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Could not create a login link." },
      { status: 500 },
    );
  }

  const hashed = linkData.properties?.hashed_token;
  const url = hashed
    ? `${siteUrl ?? ""}/auth/confirm?token_hash=${hashed}&type=magiclink&redirect=${encodeURIComponent(redirect)}`
    : (linkData.properties?.action_link ?? null);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "No login link produced." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, url });
}
