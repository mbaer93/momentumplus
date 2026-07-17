"use client";

import { useMemo, useState } from "react";
import { useNowTick } from "./useNowTick";
import type { SessionDetail } from "@/lib/types";
import { displayStatus } from "@/lib/sessions/view";
import { SessionCard } from "./SessionCard";
import { AdminEditChip } from "@/components/admin/AdminChips";

type Filter =
  | "all"
  | "upcoming"
  | "enrolled"
  | "attended"
  | "Leadership"
  | "Wellness"
  | "Business"
  | "Networking";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All Sessions" },
  { key: "upcoming", label: "Upcoming" },
  { key: "enrolled", label: "Enrolled" },
  { key: "attended", label: "Attended" },
  { key: "Leadership", label: "Leadership" },
  { key: "Wellness", label: "Wellness" },
  { key: "Business", label: "Business" },
  { key: "Networking", label: "Networking" },
];

export function SessionsBrowser({
  sessions,
  isAdmin = false,
}: {
  sessions: SessionDetail[];
  isAdmin?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  // Compute once on the client so the time-derived status is consistent.
  const now = useNowTick();

  const visible = useMemo(() => {
    const filtered = sessions.filter((s) => {
      const status = displayStatus(s, now);
      // Members never see drafts mixed into the list; admins see them
      // badged (the card shows a Draft pill).
      if (status === "draft" && !isAdmin) return false;
      switch (filter) {
        case "all":
          return true;
        case "upcoming":
          return status === "live" || status === "upcoming" || status === "enrolled";
        case "enrolled":
          return s.isEnrolled;
        case "attended":
          return status === "attended";
        case "Leadership":
        case "Wellness":
        case "Business":
        case "Networking":
          return s.category === filter;
        default:
          return true;
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
