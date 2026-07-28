/*
 * Library seasons.
 *
 * A season opens on October 1 (Eastern) — the same boundary the speaker and
 * sponsor terms already use (migration 0028) — and is labelled by the year it
 * opened. So everything published between Oct 1 2025 and Sep 30 2026 is
 * season 2025.
 *
 * This mirrors season_of() / current_library_season() in migration 0055. The
 * database is the gate; these are for labelling and for the preview-mode
 * dataset that has no database behind it.
 */

import type { LibraryScope } from "./tiers";

function easternParts(d: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month") };
}

/** The season a moment belongs to, or null for a null date. */
export function seasonOf(date: Date | string | null): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const { year, month } = easternParts(d);
  return month >= 10 ? year : year - 1;
}

export function currentSeason(now: Date = new Date()): number {
  return seasonOf(now) as number;
}

/** "2025–26" — how a season reads on a card or a filter chip. */
export function seasonLabel(season: number | null): string {
  if (season === null) return "";
  return `${season}–${String((season + 1) % 100).padStart(2, "0")}`;
}

/**
 * Is content from `season` inside this scope?
 *
 * Content with no season (nothing to date it by) is treated as current — it
 * is better to show a member a recording they may keep than to hide one they
 * paid for.
 */
export function seasonInScope(
  scope: LibraryScope,
  season: number | null,
  now: Date = new Date(),
): boolean {
  if (scope === "none") return false;
  if (scope === "all_seasons") return true;
  return season === null || season >= currentSeason(now);
}
