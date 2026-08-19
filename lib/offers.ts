import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requestCache } from "@/lib/request-cache";

/*
 * Targeted in-app offers (migration 0093).
 *
 * The offer a member sees is decided by the DATABASE — the RLS policy on
 * `offers` only returns rows they are actually targeted by. This module
 * reads with the service role for one narrow reason (dismissals and the
 * badge join in one pass), so it re-applies the same rule in SQL rather
 * than trusting the caller; the policy remains the backstop for every
 * other path, including anything reading through the anon key.
 */

export interface MemberOffer {
  id: string;
  title: string;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  endsAt: string | null;
}

interface OfferRow {
  id: string;
  title: string;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  ends_at: string | null;
  audience_badges: string[] | null;
  audience_tiers: string[] | null;
}

/**
 * The offer to show this member right now, or null.
 *
 * One at a time, soonest-to-expire first. A stack of banners on a dashboard
 * is an advert column, not an offer — and the one about to lapse is the one
 * worth acting on.
 */
export const offerForMember = requestCache(
  async (profileId: string): Promise<MemberOffer | null> => {
    if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return null;
    }
    const admin = createServiceClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await admin
      .from("offers")
      .select(
        "id, title, body, cta_label, cta_url, ends_at, audience_badges, audience_tiers",
      )
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("ends_at", { ascending: true, nullsFirst: false })
      .limit(50);
    // Pre-migration 0093 there are no offers — not an error worth a banner.
    if (error || !data?.length) return null;

    const [badges, tiers, dismissed] = await Promise.all([
      admin.from("member_badges").select("badge_key").eq("profile_id", profileId),
      admin
        .from("memberships")
        .select("tier")
        .eq("profile_id", profileId)
        .in("status", ["active", "past_due"]),
      admin.from("offer_dismissals").select("offer_id").eq("profile_id", profileId),
    ]);

    const myBadges = new Set(
      (badges.data ?? []).map((r) => String(r.badge_key)),
    );
    const myTiers = new Set((tiers.data ?? []).map((r) => String(r.tier)));
    const closed = new Set(
      (dismissed.data ?? []).map((r) => String(r.offer_id)),
    );

    for (const row of data as OfferRow[]) {
      if (closed.has(row.id)) continue;
      const wantsBadges = row.audience_badges ?? [];
      const wantsTiers = row.audience_tiers ?? [];
      /*
       * An offer targeting nobody is shown to nobody. The alternative —
       * treating "no audience" as "everyone" — turns a half-finished draft
       * into a discount for the entire member base.
       */
      if (wantsBadges.length === 0 && wantsTiers.length === 0) continue;
      const match =
        wantsBadges.some((b) => myBadges.has(b)) ||
        wantsTiers.some((t) => myTiers.has(t));
      if (!match) continue;
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        ctaLabel: row.cta_label,
        ctaUrl: row.cta_url,
        endsAt: row.ends_at,
      };
    }
    return null;
  },
);
