import Link from "next/link";
import type { CSSProperties } from "react";

/*
 * Season preview switch for the Speakers/Sponsors directories. Shown only
 * to admins, speakers, and sponsor managers — members always see the live
 * season. "Next season" previews the roster that goes live at the upcoming
 * October 1 (pre-season speakers/sponsors are otherwise hidden).
 */
export function SeasonToggle({
  base,
  next,
  nextLabel,
}: {
  /** The page path, e.g. "/speakers". */
  base: string;
  /** True when the next-season view is active. */
  next: boolean;
  /** Human label for the next season, e.g. "Oct 1, 2026 – Oct 1, 2027". */
  nextLabel: string;
}) {
  const pill = (active: boolean): CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 4,
    textDecoration: "none",
    border: `1px solid ${active ? "var(--gold)" : "var(--border)"}`,
    color: active ? "var(--gold)" : "var(--mid-gray)",
    background: active ? "rgba(184, 150, 90, 0.08)" : "transparent",
  });
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        margin: "12px 0 4px",
      }}
    >
      <Link href={base} style={pill(!next)}>
        This season
      </Link>
      <Link href={`${base}?season=next`} style={pill(next)}>
        Next season
      </Link>
      {next && (
        <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
          Previewing {nextLabel} — members see this lineup after October 1.
        </span>
      )}
    </div>
  );
}
