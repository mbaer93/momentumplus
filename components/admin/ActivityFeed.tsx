"use client";

import { useMemo, useState } from "react";
import type { ActivityEvent, ActivityKind } from "@/lib/activity";

/*
 * Categorized activity views — each tab is its own aspect of the platform,
 * not one endless merged log. Onboarding shows the invite → first-login
 * funnel; the others show what members actually do once they're in.
 */

interface Category {
  key: string;
  label: string;
  desc: string;
  kinds: ActivityKind[];
}

const CATEGORIES: Category[] = [
  {
    key: "onboarding",
    label: "Onboarding",
    desc: "Invites going out, invites being accepted, and recent sign-ins.",
    kinds: ["invite_sent", "first_login", "signed_in"],
  },
  {
    key: "memberships",
    label: "Memberships",
    desc: "New and granted memberships, by level and source.",
    kinds: ["membership"],
  },
  {
    key: "sessions",
    label: "Sessions",
    desc: "Session enrollments (attended sessions are marked).",
    kinds: ["enrolled"],
  },
  {
    key: "learning",
    label: "Learning",
    desc: "Lessons completed in Education and recordings watched in the Library.",
    kinds: ["lesson_completed", "video_watched"],
  },
  {
    key: "engagement",
    label: "Engagement",
    desc: "Resources opened, sponsor clicks, and announcements sent.",
    kinds: ["resource_opened", "sponsor_click", "announcement"],
  },
];

function chipClass(kind: ActivityKind): string {
  switch (kind) {
    case "first_login":
    case "signed_in":
      return "completed";
    case "invite_sent":
    case "membership":
      return "draft";
    default:
      return "live";
  }
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const [active, setActive] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState("");

  const category = CATEGORIES.find((c) => c.key === active) ?? CATEGORIES[0];

  const countsByKind = useMemo(() => {
    const m = new Map<ActivityKind, number>();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [events]);

  const categoryCount = (c: Category) =>
    c.kinds.reduce((n, k) => n + (countsByKind.get(k) ?? 0), 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (!category.kinds.includes(e.kind)) return false;
      if (!q) return true;
      return (
        e.memberName.toLowerCase().includes(q) ||
        e.memberEmail.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q)
      );
    });
  }, [events, query, category]);

  return (
    <div>
      <div className="profile-tabs" style={{ marginBottom: 14 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`profile-tab${active === c.key ? " active" : ""}`}
            onClick={() => {
              setActive(c.key);
              setQuery("");
            }}
          >
            {c.label} ({categoryCount(c)})
          </button>
        ))}
      </div>

      <div
        className="admin-form-actions"
        style={{ marginTop: 0, marginBottom: 12, flexWrap: "wrap", gap: 12 }}
      >
        <span style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
          {category.desc}
        </span>
        <input
          type="search"
          placeholder="Filter by member or detail…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter activity"
          style={{ minWidth: 240, marginLeft: "auto" }}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ whiteSpace: "nowrap" }}>When (ET)</th>
              <th>Member</th>
              <th>Activity</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e, i) => (
              <tr key={`${e.at}-${e.kind}-${i}`}>
                <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                  {timeLabel(e.at)}
                </td>
                <td>
                  <div className="admin-row-title" style={{ fontSize: 13.5 }}>
                    {e.memberName || "Momentum+ Team"}
                  </div>
                  {e.memberEmail && (
                    <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                      {e.memberEmail}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`admin-status ${chipClass(e.kind)}`}>
                    {e.kindLabel}
                  </span>
                </td>
                <td style={{ fontSize: 13, color: "var(--mid-gray)" }}>
                  {e.detail || "—"}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "var(--mid-gray)", fontSize: 13 }}>
                  No {category.label.toLowerCase()} activity
                  {query ? " matches that filter" : " recorded"} yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, fontSize: 12, color: "var(--mid-gray)" }}>
        Each tab shows the most recent events for that category. Sign-in
        entries reflect each member&apos;s most recent visit.
      </p>
    </div>
  );
}
