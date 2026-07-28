/*
 * Page-level feature gating.
 *
 * The database is the boundary (has_feature() in 0054, plus per-table RLS).
 * This is the layer that turns "you can't reach this" into a page a member
 * can actually read, instead of an empty list or a 500.
 */

import { redirect } from "next/navigation";
import { getCurrentMember } from "./current-member";
import { getAccessMatrix, tierHasFeature } from "./tiers";

/**
 * Guard a feature-gated page. Sends a member who isn't entitled to the
 * upgrade page with enough context to explain what they were reaching for,
 * rather than a bare 404 (they should know the feature exists — that's the
 * whole point of the padlocks).
 */
export async function requireFeature(featureKey: string): Promise<void> {
  const [member, matrix] = await Promise.all([
    getCurrentMember(),
    getAccessMatrix(),
  ]);
  if (!member) redirect("/login");
  if (member.isAdmin) return;
  if (!tierHasFeature(matrix, member.tier, featureKey)) {
    redirect(`/upgrade?feature=${encodeURIComponent(featureKey)}`);
  }
}

/** Non-redirecting form, for pages that want to render their own locked state. */
export async function hasFeature(featureKey: string): Promise<boolean> {
  const [member, matrix] = await Promise.all([
    getCurrentMember(),
    getAccessMatrix(),
  ]);
  if (!member) return false;
  return tierHasFeature(matrix, member.tier, featureKey);
}
