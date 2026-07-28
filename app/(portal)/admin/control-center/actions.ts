"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { logAdminAction } from "@/lib/admin-audit";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { LibraryScope } from "@/lib/tiers";
import { isInternalTier } from "@/lib/tiers-shared";

export interface ControlResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

/*
 * Everything here is Super Admin only. A standard admin runs the day to day;
 * deciding which tiers exist and what a paying member gets is not day to day
 * (Matt, 2026-07-28), so this deliberately ignores the per-area permissions
 * and asks for the role.
 */
async function requireSuper(): Promise<
  { ok: true; userId: string; userEmail: string | null } | { ok: false; message: string }
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.access.role !== "super") {
    return { ok: false, message: "The Control Center is Super Admin only." };
  }
  return { ok: true, userId: auth.userId, userEmail: auth.userEmail };
}

/** The audit log has no generic target column — the slug goes in `detail`. */
function audit(
  actor: { userId: string; userEmail: string | null },
  action: string,
  detail: string,
) {
  return logAdminAction({
    actorId: actor.userId,
    actorEmail: actor.userEmail,
    action,
    detail,
  });
}

/*
 * Access changes land in the sidebar, every gated page and the public pricing
 * grid, all of which are statically hinted. Bust broadly — this runs when a
 * human presses a switch, not on a hot path.
 */
function bust() {
  revalidatePath("/", "layout");
}

const PREVIEW: ControlResult = {
  ok: true,
  preview: true,
  message: "Saved (preview mode — no database configured).",
};

// ---------------------------------------------------------------------------
// Launch switches
// ---------------------------------------------------------------------------

/**
 * Put a tier on sale, or take it back off.
 *
 * `went_live_at` is stamped once and kept: it is the record of when a tier
 * was first offered, which the pricing page uses to avoid calling a
 * relaunched tier "new".
 */
export async function setTierPublic(
  slug: string,
  isPublic: boolean,
): Promise<ControlResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const auth = await requireSuper();
  if (!auth.ok) return { ok: false, message: auth.message };

  // Granted roles are never sold. Only the PUBLISH direction is refused —
  // a row flipped public before this guard existed can still be taken back.
  if (isPublic && isInternalTier(slug)) {
    return {
      ok: false,
      message:
        "That's a granted role, not a product — it can't be put on sale. Admins, speakers and sponsors get their access from you, never from checkout.",
    };
  }

  const db = createServiceClient();
  const { data: existing, error: readErr } = await db
    .from("member_tiers")
    .select("slug, label, went_live_at")
    .eq("slug", slug)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  if (!existing) return { ok: false, message: "That tier no longer exists." };

  const { error } = await db
    .from("member_tiers")
    .update({
      is_public: isPublic,
      went_live_at:
        isPublic && !existing.went_live_at
          ? new Date().toISOString()
          : existing.went_live_at,
    })
    .eq("slug", slug);
  if (error) return { ok: false, message: error.message };

  await audit(
    auth,
    isPublic ? "tier.go_live" : "tier.unpublish",
    `${existing.label ?? slug} (${slug})`,
  );
  bust();
  return {
    ok: true,
    message: isPublic
      ? `${existing.label} is live — it now appears in pricing and checkout.`
      : `${existing.label} is hidden from the public again.`,
  };
}

/** Ship a feature (or pull it back to admins-only). */
export async function setFeatureLaunched(
  key: string,
  isLaunched: boolean,
): Promise<ControlResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const auth = await requireSuper();
  if (!auth.ok) return { ok: false, message: auth.message };

  const db = createServiceClient();
  const { error } = await db
    .from("app_features")
    .update({ is_launched: isLaunched })
    .eq("key", key);
  if (error) return { ok: false, message: error.message };

  await audit(auth, isLaunched ? "feature.go_live" : "feature.unlaunch", key);
  bust();
  return {
    ok: true,
    message: isLaunched
      ? "Live. Members on a tier that includes it can reach it now."
      : "Pulled back — admins only until you launch it again.",
  };
}

// ---------------------------------------------------------------------------
// The access grid
// ---------------------------------------------------------------------------

export async function setTierFeature(
  tierSlug: string,
  featureKey: string,
  allowed: boolean,
): Promise<ControlResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const auth = await requireSuper();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { error } = await createServiceClient()
    .from("tier_features")
    .upsert(
      { tier_slug: tierSlug, feature_key: featureKey, allowed },
      { onConflict: "tier_slug,feature_key" },
    );
  if (error) return { ok: false, message: error.message };

  await audit(
    auth,
    "tier_feature.set",
    `${tierSlug} → ${featureKey}: ${allowed ? "granted" : "restricted"}`,
  );
  bust();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export interface TierInput {
  label: string;
  description: string;
  rank: string;
  libraryScope: LibraryScope;
  clearsVipPlus: boolean;
  clearsProOnly: boolean;
  countsTowardSpeakerPay: boolean;
}

/** Slugs are what memberships store, so they must be stable and boring. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function tierRow(input: TierInput) {
  const rank = Number.parseInt(input.rank, 10);
  return {
    label: input.label.trim(),
    description: input.description.trim(),
    rank: Number.isFinite(rank) ? rank : 500,
    library_scope: input.libraryScope,
    clears_vip_plus: input.clearsVipPlus,
    clears_pro_only: input.clearsProOnly,
    counts_toward_speaker_pay: input.countsTowardSpeakerPay,
  };
}

/**
 * Create a member type.
 *
 * New tiers start private and with nothing granted — the grid is where you
 * say what they reach, and Go Live is a separate, deliberate press.
 */
export async function createTier(input: TierInput): Promise<ControlResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const auth = await requireSuper();
  if (!auth.ok) return { ok: false, message: auth.message };
  const label = input.label.trim();
  if (!label) return { ok: false, message: "The tier needs a name." };

  const slug = slugify(label);
  if (!slug) {
    return { ok: false, message: "That name doesn't produce a usable id." };
  }

  const db = createServiceClient();
  const { data: clash } = await db
    .from("member_tiers")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (clash) {
    return { ok: false, message: `A tier with the id "${slug}" already exists.` };
  }

  const { error } = await db.from("member_tiers").insert({
    slug,
    ...tierRow(input),
    is_builtin: false,
    is_public: false,
  });
  if (error) return { ok: false, message: error.message };

  await audit(auth, "tier.create", `${label} (${slug})`);
  bust();
  return {
    ok: true,
    message: `${label} created. It reaches nothing until you tick features below, and stays off the public site until you press Go Live.`,
  };
}

export async function updateTier(
  slug: string,
  input: TierInput,
): Promise<ControlResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const auth = await requireSuper();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!input.label.trim()) return { ok: false, message: "The tier needs a name." };

  const { error } = await createServiceClient()
    .from("member_tiers")
    .update(tierRow(input))
    .eq("slug", slug);
  if (error) return { ok: false, message: error.message };

  await audit(auth, "tier.update", slug);
  bust();
  return { ok: true, message: "Saved." };
}

/**
 * Archive a custom tier.
 *
 * Never a hard delete and never a built-in: memberships store the slug, and
 * removing the row would leave paying members pointing at nothing. Archiving
 * takes it off every list while the rows that reference it stay readable.
 */
export async function archiveTier(slug: string): Promise<ControlResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const auth = await requireSuper();
  if (!auth.ok) return { ok: false, message: auth.message };

  const db = createServiceClient();
  const { data: tier } = await db
    .from("member_tiers")
    .select("slug, label, is_builtin")
    .eq("slug", slug)
    .maybeSingle();
  if (!tier) return { ok: false, message: "That tier no longer exists." };
  if (tier.is_builtin) {
    return {
      ok: false,
      message:
        "Built-in tiers can't be archived — take them off sale with Go Live instead.",
    };
  }

  const { count } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("tier", slug)
    .in("status", ["active", "past_due", "canceled"]);
  if (count && count > 0) {
    return {
      ok: false,
      message: `${count} member${count === 1 ? " is" : "s are"} still on ${tier.label}. Move them to another tier first.`,
    };
  }

  const { error } = await db
    .from("member_tiers")
    .update({ archived_at: new Date().toISOString(), is_public: false })
    .eq("slug", slug);
  if (error) return { ok: false, message: error.message };

  await audit(auth, "tier.archive", slug);
  bust();
  return { ok: true, message: `${tier.label} archived.` };
}
