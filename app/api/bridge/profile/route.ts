import { NextResponse, type NextRequest } from "next/server";
import { findAuthUserIdByEmail } from "@/lib/onboarding";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Cross-app profile sync from the TSLS Companion (the single front door).
 * TSLS is the source of truth for a speaker's identity, so when an admin
 * enters or edits a speaker there, TSLS pushes the profile fields here and
 * we mirror them onto the member's Momentum+ speaker listing — "enter once,
 * appears in both". This never creates a login (account provisioning is the
 * Zapier webhook's job); it only decorates an account that already exists.
 *
 *   POST /api/bridge/profile
 *   Header:  x-api-key: <ZAPIER_WEBHOOK_SECRET>   (same trust boundary as
 *            provisioning — TSLS already holds this as MOMENTUM_PROVISION_KEY)
 *   Body:    { "kind": "speaker", "email": "...", "name": "...",
 *              "title"?, "bio"?, "headshotUrl"?, "website"?, "tags"?: [] }
 *
 * Merge semantics: only fields TSLS actually sends (non-empty) overwrite
 * Momentum+ — a blank on the TSLS side never wipes a value the member set
 * inside Momentum+.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.ZAPIER_WEBHOOK_SECRET;
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

function cleanStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanTags(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
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

  const kind = cleanStr(body.kind) || "speaker";
  if (kind !== "speaker") {
    // Sponsor sync is intentionally not handled here yet — its Momentum+
    // listing is sponsor-facing and has its own onboarding flow.
    return NextResponse.json(
      { error: `Unsupported kind "${kind}". Only "speaker" is synced.` },
      { status: 400 },
    );
  }

  const email = cleanStr(body.email).toLowerCase();
  const name = cleanStr(body.name);
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const profileId = await findAuthUserIdByEmail(email);
  if (!profileId) {
    // No Momentum+ account for this email yet — provisioning happens
    // separately, and TSLS re-syncs on the next edit. Not an error.
    return NextResponse.json({ ok: true, skipped: "no-account" }, { status: 200 });
  }

  const title = cleanStr(body.title);
  const bio = cleanStr(body.bio);
  const headshotUrl = cleanStr(body.headshotUrl);
  const website = cleanStr(body.website);
  const tags = cleanTags(body.tags);

  const admin = createServiceClient();

  // One speaker row per member (keyed by profile_id). Update in place if it
  // exists; otherwise create it linked to the account.
  const { data: existing } = await admin
    .from("speakers")
    .select("id, links")
    .eq("profile_id", profileId)
    .maybeSingle();

  // Build a patch of only the fields TSLS actually provided, so a blank on
  // the TSLS side can't erase something the member entered in Momentum+.
  const patch: Record<string, unknown> = {};
  if (name) patch.name = name;
  if (title) patch.title = title;
  if (bio) patch.bio = bio;
  if (headshotUrl) patch.headshot_url = headshotUrl;
  if (tags.length > 0) patch.industries = tags;
  if (website) {
    const links =
      existing?.links && typeof existing.links === "object"
        ? { ...(existing.links as Record<string, unknown>) }
        : {};
    links.website = website;
    patch.links = links;
  }

  if (existing?.id) {
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, updated: false }, { status: 200 });
    }
    const { error } = await admin
      .from("speakers")
      .update(patch)
      .eq("id", existing.id as string);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, updated: true }, { status: 200 });
  }

  // Insert needs a name; fall back to the email's local part if TSLS somehow
  // sent none (the DB column is NOT NULL).
  const { error } = await admin.from("speakers").insert({
    profile_id: profileId,
    name: name || email.split("@")[0],
    title: title || null,
    bio: bio || null,
    headshot_url: headshotUrl || null,
    industries: tags,
    links: website ? { website } : {},
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, created: true }, { status: 200 });
}
