"use client";

import { useMemo, useState } from "react";
import { useNowTick } from "./useNowTick";
import type { SessionDetail } from "@/lib/types";
import { displayStatus } from "@/lib/sessions/view";
import { displayCategory } from "@/lib/programs";
import { SessionCard } from "./SessionCard";
import { AdminEditChip } from "@/components/admin/AdminChips";

// Category filters follow the current taxonomy (Sierra, 2026-07-22);
// legacy-category sessions still appear under All / Upcoming.
const CATEGORY_FILTERS = [
  "Monthly Educational Session",
  "Accountability Session",
  "Productivity Session",
  "AI Leadership Lab",
  "Bonus Sessions",
] as const;

type Filter =
  | "all"
  | "upcoming"
  | "enrolled"
  | "attended"
  | (typeof CATEGORY_FILTERS)[number];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All Sessions" },
  { key: "upcoming", label: "Upcoming" },
  { key: "enrolled", label: "Enrolled" },
  { key: "attended", label: "Attended" },
  ...CATEGORY_FILTERS.map((c) => ({ key: c, label: c }) as const),
];

export function SessionsBrowser({
  sessions,
  isAdmin = false,
  hideFilters = false,
}: {
  sessions: SessionDetail[];
  isAdmin?: boolean;
  /** Drop-in programs (Rooted Focus): no enrollment, so no filter tabs —
      members just see the schedule. */
  hideFilters?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  // Compute once on the client so the time-derived status is consistent.
  const now = useNowTick();

  const visible = useMemo(() => {
    const filtered = sessions.filter((s) => {
      const status = displayStatus(s, now);
      // Members never see drafts mixed into the list; admins see them
      // badged (the card shows a Draft pill). Archived sessions (their
      // speaker's season ended) are likewise admin-only.
      if (status === "draft" && !isAdmin) return false;
      if (s.status === "archived" && !isAdmin) return false;
      // COMPLETED sessions leave the sessions page (Matt, 2026-07-20) —
      // their recording, notes, and AI summary live in the Library. The
      // Attended filter stays as the member's personal history.
      if (s.status === "completed" && !isAdmin && filter !== "attended") {
        return false;
      }
      switch (filter) {
        case "all":
          return true;
        case "upcoming":
          return status === "live" || status === "upcoming" || status === "enrolled";
        case "enrolled":
          return s.isEnrolled;
        case "attended":
          return status === "attended";
        default:
          return displayCategory(s) === filter;
      }
    });
    // Live and upcoming sessions lead (soonest first); past ones follow,
    // newest first — the old ascending-only sort opened the page on a wall
    // of January recordings after a few months.
    const upcoming = filtered
      .filter((s) => new Date(s.startsAt).getTime() + s.durationMin * 60000 >= now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const past = filtered
      .filter((s) => new Date(s.startsAt).getTime() + s.durationMin * 60000 < now)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    return [...upcoming, ...past];
  }, [sessions, filter, now, isAdmin]);

  return (
    <>
      {!hideFilters && (
        <div className="filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-btn${filter === f.key ? " active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="sessions-grid">
        {visible.length === 0 ? (
          <div className="sessions-empty">No sessions match this filter yet.</div>
        ) : (
          visible.map((s) =>
            isAdmin ? (
              <div key={s.id} style={{ position: "relative" }}>
                <span className="admin-chip-overlay">
                  <AdminEditChip href={`/admin/sessions/${s.id}/edit`} />
                </span>
                <SessionCard session={s} now={now} />
              </div>
            ) : (
              <SessionCard key={s.id} session={s} now={now} />
            ),
          )
        )}
      </div>
    </>
  );
}
