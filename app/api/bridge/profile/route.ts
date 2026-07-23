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
 *   Body (speaker): { "kind": "speaker", "email", "name",
 *              "title"?, "bio"?, "headshotUrl"?, "website"?, "tags"?: [] }
 *   Body (sponsor): { "kind": "sponsor", "email", "name" (business),
 *              "tier"?, "tagline"?, "description"?, "website"? }
 *
 * Speaker sync writes the member's live speaker listing directly. Sponsor
 * sync is prefill-only: it never touches a live sponsor listing — it seeds
 * the member's sponsor-onboarding invite so the rep confirms and publishes
 * inside Momentum+ (a sponsor listing is member-facing; we don't auto-show
 * a half-entered one).
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
  if (kind !== "speaker" && kind !== "sponsor") {
    return NextResponse.json(
      { error: `Unsupported kind "${kind}". Use "speaker" or "sponsor".` },
      { status: 400 },
    );
  }

  const email = cleanStr(body.email).toLowerCase();
  const name = cleanStr(body.name);
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const profileId = await findAuthUserIdByEmail(email);

  if (kind === "sponsor") {
    return syncSponsorInvite({
      email,
      name,
      profileId,
      tier: cleanStr(body.tier),
      tagline: cleanStr(body.tagline),
      description: cleanStr(body.description),
      website: cleanStr(body.website),
    });
  }

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

/*
 * Sponsor prefill: seed (or refresh) the member's pending sponsor-onboarding
 * invite with the business details entered in TSLS. Never creates a live
 * sponsor listing — the rep confirms and publishes inside Momentum+. If the
 * sponsor already finished onboarding (a completed invite exists), we leave
 * it alone rather than dragging them back through setup.
 */
async function syncSponsorInvite(input: {
  email: string;
  name: string;
  profileId: string | null;
  tier: string;
  tagline: string;
  description: string;
  website: string;
}): Promise<NextResponse> {
  const admin = createServiceClient();
  const { emailPattern } = await import("@/lib/db-utils");
  const pattern = emailPattern(input.email);

  // Already onboarded → don't re-open setup for them.
  const { data: completed } = await admin
    .from("sponsor_invites")
    .select("id")
    .ilike("email", pattern)
    .not("completed_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (completed?.id) {
    return NextResponse.json({ ok: true, skipped: "already-onboarded" }, { status: 200 });
  }

  const { normalizeSponsorTier } = await import("@/lib/sponsor-tiers");
  const tier = normalizeSponsorTier(input.tier || "partner");

  // Prefill columns arrive with migration 0052; degrade gracefully if the
  // migration hasn't run yet (business_name + tier still prefill).
  const full: Record<string, unknown> = {
    email: input.email,
    tier,
    business_name: input.name || null,
    tagline: input.tagline || null,
    description: input.description || null,
    website: input.website || null,
  };
  if (input.profileId) full.invited_profile_id = input.profileId;

  const { data: pending } = await admin
    .from("sponsor_invites")
    .select("id")
    .ilike("email", pattern)
    .is("completed_at", null)
    .maybeSingle();

  const write = async (row: Record<string, unknown>) =>
    pending?.id
      ? admin.from("sponsor_invites").update(row).eq("id", pending.id as string)
      : admin.from("sponsor_invites").insert({ ...row, completed_at: null });

  let { error } = await write(full);
  if (error && /tagline|description|website/.test(error.message)) {
    const { tagline: _t, description: _d, website: _w, ...base } = full;
    ({ error } = await write(base));
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, prefilled: true, updated: Boolean(pending?.id) },
    { status: 200 },
  );
}
