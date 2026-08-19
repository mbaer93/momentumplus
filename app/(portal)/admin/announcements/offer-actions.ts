"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Admin CRUD for targeted offers (migration 0093).
 *
 * The offer is content, not pricing: a title, a line of copy, a button
 * label, and a URL the admin supplies (a Stripe payment link, a GHL funnel,
 * a form). Nothing here mints a discount or knows what anything costs, so
 * this can never disagree with the real prices.
 */

export interface AdminOffer {
  id: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  audienceBadges: string[];
  audienceTiers: string[];
  endsAt: string | null;
  active: boolean;
}

export interface OfferInput {
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  audienceBadges: string[];
  audienceTiers: string[];
  /** ISO, or "" for no end date. */
  endsAt: string;
}

export async function listOffers(): Promise<AdminOffer[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return [];
  const { data, error } = await createServiceClient()
    .from("offers")
    .select(
      "id, title, body, cta_label, cta_url, audience_badges, audience_tiers, ends_at, active",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []).map((o) => ({
    id: o.id as string,
    title: (o.title as string) ?? "",
    body: (o.body as string) ?? "",
    ctaLabel: (o.cta_label as string) ?? "",
    ctaUrl: (o.cta_url as string) ?? "",
    audienceBadges: (o.audience_badges as string[]) ?? [],
    audienceTiers: (o.audience_tiers as string[]) ?? [],
    endsAt: (o.ends_at as string) ?? null,
    active: o.active !== false,
  }));
}

export async function saveOffer(
  input: OfferInput,
): Promise<{ ok: boolean; message: string }> {
  if (!input.title.trim()) {
    return { ok: false, message: "Give the offer a title." };
  }
  /*
   * An offer with no audience would be a draft that reaches nobody — the
   * member-side query skips it deliberately, so refusing it here is the
   * honest version of the same rule rather than a silent no-op.
   */
  if (
    input.audienceBadges.length === 0 &&
    input.audienceTiers.length === 0
  ) {
    return {
      ok: false,
      message: "Pick at least one badge or tier — an offer aimed at nobody is shown to nobody.",
    };
  }
  if (input.ctaUrl && !/^https?:\/\//i.test(input.ctaUrl)) {
    return { ok: false, message: "The button link needs to start with https://" };
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, message: "Preview mode — nothing saved." };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message ?? "Not allowed." };

  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    return { ok: false, message: "That end date isn't valid." };
  }

  const { error } = await createServiceClient().from("offers").insert({
    title: input.title.trim(),
    body: input.body.trim() || null,
    cta_label: input.ctaLabel.trim() || null,
    cta_url: input.ctaUrl.trim() || null,
    audience_badges: input.audienceBadges,
    audience_tiers: input.audienceTiers,
    ends_at: endsAt ? endsAt.toISOString() : null,
    active: true,
    created_by: auth.userId,
  });
  if (error) {
    return {
      ok: false,
      message: /offers/.test(error.message)
        ? "The offers table isn't there yet — run migration 0093."
        : error.message,
    };
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "Offer is live for everyone it targets.",
  };
}

/** Switch an offer off (or back on). Never deletes — the dismissals and the
    record of what was offered stay. */
export async function setOfferActive(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, message: "Preview mode." };
  }
  const auth = await requireAdmin("announcements");
  if (!auth.ok) return { ok: false, message: auth.message ?? "Not allowed." };
  const { error } = await createServiceClient()
    .from("offers")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/announcements");
  revalidatePath("/dashboard");
  return { ok: true, message: active ? "Offer switched on." : "Offer switched off." };
}
