/*
 * The tier + feature registry (migration 0054).
 *
 * Tiers used to be a Postgres enum mirrored by half a dozen hand-maintained
 * TypeScript arrays. They are rows now, so Matt can stand up a new member
 * type from the Control Center and set what it reaches without a deploy.
 *
 * Everything here is READ-side. The Control Center's writes live in
 * app/(portal)/admin/control-center/actions.ts.
 *
 * NOTE: like lib/access.ts, these helpers mirror the database for UI
 * convenience. The boundary is RLS — can_view(), has_feature() and
 * library_season_ok() in 0054/0055 (CLAUDE.md non-negotiable #1).
 */

import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import { requestCache } from "./request-cache";
import { isInternalTier } from "./tiers-shared";

export type LibraryScope = "none" | "current_season" | "all_seasons";

export interface TierDef {
  slug: string;
  label: string;
  description: string;
  rank: number;
  isBuiltin: boolean;
  /** Offered to the public — appears in pricing and checkout. */
  isPublic: boolean;
  wentLiveAt: string | null;
  clearsVipPlus: boolean;
  clearsProOnly: boolean;
  libraryScope: LibraryScope;
  /** Counts as a monthly user for speaker-of-the-month reporting and pay. */
  countsTowardSpeakerPay: boolean;
  archivedAt: string | null;
}

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  navHref: string | null;
  sort: number;
  /** Global switch. False = nobody but an admin reaches it, whatever the grid says. */
  isLaunched: boolean;
}

export interface AccessMatrix {
  tiers: TierDef[];
  features: FeatureDef[];
  /** grants[tierSlug][featureKey] — missing means not granted. */
  grants: Record<string, Record<string, boolean>>;
}

/*
 * Preview mode (no Supabase env) still has to render a sidebar and a pricing
 * grid, so the seed from 0054 is mirrored here. Keep the two in step: this is
 * what the e2e suite and local dev run against.
 */
const PREVIEW_TIERS: TierDef[] = [
  ["admin", "Administrator", 10, false, true, true, "all_seasons"],
  ["pro", "Momentum+ Pro", 20, false, true, true, "all_seasons"],
  ["sponsor", "Sponsor", 30, false, true, true, "all_seasons"],
  ["speaker", "Speaker", 40, false, true, false, "all_seasons"],
  ["sub_annual", "Annual Member", 50, false, true, false, "all_seasons"],
  ["tsls_vip", "VIP Member", 60, false, true, false, "all_seasons"],
  ["sub_6mo", "6-Month Member", 70, false, false, false, "current_season"],
  ["sub_3mo", "3-Month Member", 80, false, false, false, "current_season"],
  ["sub_monthly", "Monthly Member", 90, false, false, false, "current_season"],
  ["basic", "Momentum+ Member", 100, true, false, false, "current_season"],
  ["lite", "Momentum+ Lite", 105, false, false, false, "none"],
  ["vip", "VIP Access", 110, false, false, false, "current_season"],
  ["gift", "Gift Member", 120, false, false, false, "current_season"],
  ["tsls_attendee", "Summit Attendee", 130, false, false, false, "current_season"],
].map(([slug, label, rank, isPublic, vip, pro, scope]) => ({
  slug: slug as string,
  label: label as string,
  description: "",
  rank: rank as number,
  isBuiltin: true,
  isPublic: isPublic as boolean,
  wentLiveAt: null,
  clearsVipPlus: vip as boolean,
  clearsProOnly: pro as boolean,
  libraryScope: scope as LibraryScope,
  countsTowardSpeakerPay: !["admin", "speaker", "sponsor", "lite"].includes(
    slug as string,
  ),
  archivedAt: null,
}));

// Dashboard and My Profile are absent on purpose — see 0054. A member must
// always be able to reach their own plan and billing.
const PREVIEW_FEATURES: FeatureDef[] = [
  ["sessions", "Sessions", "/sessions", 20, true],
  ["rooted_focus", "Rooted Focus", "/rooted-focus", 30, true],
  ["calendar", "Calendar", "/calendar", 40, true],
  ["library", "Library", "/library", 50, true],
  ["education", "Grow on the Go", "/education", 60, true],
  ["branching_out", "Branching Out", "/branching-out", 62, true],
  ["aspire2achieve", "Aspire2Achieve Growth", "/aspire2achieve", 70, false],
  ["community", "Community", "/community", 80, true],
  ["members", "Members", "/members", 90, true],
  ["speakers", "Speakers", "/speakers", 100, true],
  ["networking", "Networking", "/networking", 110, false],
  ["sponsors", "Sponsors", "/sponsors", 120, true],
  ["resources", "Resources", "/resources", 130, true],
  ["services", "Additional Services", "/services", 140, true],
].map(([key, label, href, sort, launched]) => ({
  key: key as string,
  label: label as string,
  description: "",
  navHref: href as string,
  sort: sort as number,
  isLaunched: launched as boolean,
}));

/** Momentum+ Lite is the only seeded tier that is not granted everything. */
const LITE_FEATURES = new Set(["rooted_focus", "education"]);

function previewMatrix(): AccessMatrix {
  const grants: Record<string, Record<string, boolean>> = {};
  for (const t of PREVIEW_TIERS) {
    grants[t.slug] = {};
    for (const f of PREVIEW_FEATURES) {
      grants[t.slug][f.key] =
        t.slug === "lite" ? LITE_FEATURES.has(f.key) : true;
    }
  }
  return { tiers: PREVIEW_TIERS, features: PREVIEW_FEATURES, grants };
}

/*
 * One read per request, shared by the sidebar, the page guard and any card
 * that needs to draw a padlock.
 *
 * RLS does the narrowing: a signed-out visitor on the landing page sees only
 * the tiers that have gone live; a signed-in member sees them all (the
 * sidebar has to name what a locked tab would cost); admins see everything
 * including archived rows.
 */
export const getAccessMatrix = requestCache(async (): Promise<AccessMatrix> => {
  if (!isSupabaseConfigured()) return previewMatrix();

  const supabase = await createClient();
  const [tiersRes, featuresRes, grantsRes] = await Promise.all([
    supabase
      .from("member_tiers")
      .select(
        "slug, label, description, rank, is_builtin, is_public, went_live_at, clears_vip_plus, clears_pro_only, library_scope, counts_toward_speaker_pay, archived_at",
      )
      .order("rank"),
    supabase
      .from("app_features")
      .select("key, label, description, nav_href, sort, is_launched")
      .order("sort"),
    supabase.from("tier_features").select("tier_slug, feature_key, allowed"),
  ]);

  // Pre-migration (0054 not yet run in this environment): fall back to the
  // seed rather than rendering a portal with no navigation at all.
  if (tiersRes.error || featuresRes.error || grantsRes.error) {
    return previewMatrix();
  }

  const tiers: TierDef[] = (tiersRes.data ?? []).map((r) => ({
    slug: String(r.slug),
    label: String(r.label),
    description: String(r.description ?? ""),
    rank: Number(r.rank ?? 500),
    isBuiltin: Boolean(r.is_builtin),
    isPublic: Boolean(r.is_public),
    wentLiveAt: (r.went_live_at as string | null) ?? null,
    clearsVipPlus: Boolean(r.clears_vip_plus),
    clearsProOnly: Boolean(r.clears_pro_only),
    libraryScope: (r.library_scope as LibraryScope) ?? "current_season",
    countsTowardSpeakerPay: r.counts_toward_speaker_pay !== false,
    archivedAt: (r.archived_at as string | null) ?? null,
  }));

  const features: FeatureDef[] = (featuresRes.data ?? []).map((r) => ({
    key: String(r.key),
    label: String(r.label),
    description: String(r.description ?? ""),
    navHref: (r.nav_href as string | null) ?? null,
    sort: Number(r.sort ?? 100),
    isLaunched: Boolean(r.is_launched),
  }));

  const grants: Record<string, Record<string, boolean>> = {};
  for (const row of grantsRes.data ?? []) {
    const tier = String(row.tier_slug);
    (grants[tier] ??= {})[String(row.feature_key)] = Boolean(row.allowed);
  }

  // An empty feature registry would lock every member out of every tab, so
  // that falls back. An empty TIER list does not: to a signed-out visitor
  // the read policy only exposes tiers that are on sale, and "nothing is on
  // sale" is a legitimate answer the pricing grid must be allowed to give.
  if (!features.length) return previewMatrix();
  return { tiers, features, grants };
});

export function findTier(matrix: AccessMatrix, slug: string): TierDef | null {
  return matrix.tiers.find((t) => t.slug === slug) ?? null;
}

/**
 * May this tier reach this feature?
 *
 * Admins bypass both gates — previewing an unlaunched area is how Matt checks
 * it before pressing Go Live. Everyone else needs the feature launched AND
 * the grid to say yes. An unknown tier (a webhook wrote a slug nobody has
 * created) grants nothing rather than throwing.
 */
export function tierHasFeature(
  matrix: AccessMatrix,
  tier: string,
  featureKey: string,
): boolean {
  if (tier === "admin") return true;
  const feature = matrix.features.find((f) => f.key === featureKey);
  // A feature nobody has registered is not a gate — routes that predate the
  // registry keep working until someone adds them to it.
  if (!feature) return true;
  if (!feature.isLaunched) return false;
  return matrix.grants[tier]?.[featureKey] === true;
}

/** The cheapest live tier that would unlock this feature, for the upsell copy. */
export function upgradeTierFor(
  matrix: AccessMatrix,
  featureKey: string,
): TierDef | null {
  // An unlaunched feature is reachable through NO tier (tierHasFeature gates
  // on isLaunched), so no upgrade unlocks it — recommending one would promise
  // access buying can't deliver. Grants may still say every tier "has" it.
  const feature = matrix.features.find((f) => f.key === featureKey);
  if (feature && !feature.isLaunched) return null;
  const candidates = matrix.tiers
    // Internal tiers are excluded even if a row was ever flipped public —
    // "included with Administrator" is never useful upgrade copy.
    .filter((t) => t.isPublic && !t.archivedAt && !isInternalTier(t.slug))
    .filter((t) => matrix.grants[t.slug]?.[featureKey] === true)
    .sort((a, b) => b.rank - a.rank);
  return candidates[0] ?? null;
}

/** Tiers a visitor may actually buy — what the pricing grid and /join show. */
export function publicTiers(matrix: AccessMatrix): TierDef[] {
  return matrix.tiers
    .filter((t) => t.isPublic && !t.archivedAt)
    .sort((a, b) => a.rank - b.rank);
}

/** Tiers whose members count as a monthly user for speaker pay. */
export function countsTowardSpeakerPay(
  matrix: AccessMatrix,
  tier: string,
): boolean {
  return findTier(matrix, tier)?.countsTowardSpeakerPay ?? true;
}

export function libraryScopeFor(
  matrix: AccessMatrix,
  tier: string,
): LibraryScope {
  if (tier === "admin") return "all_seasons";
  return findTier(matrix, tier)?.libraryScope ?? "current_season";
}
