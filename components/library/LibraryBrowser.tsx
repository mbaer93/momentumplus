"use client";

import { useState } from "react";
import Link from "next/link";
import type { VideoItem } from "@/lib/videos/data";
import { AdminAddChip, AdminEditChip } from "@/components/admin/AdminChips";

const FILTERS = ["All", "Leadership", "Wellness", "Business"] as const;

export function LibraryBrowser({
  videos,
  isAdmin = false,
}: {
  videos: VideoItem[];
  isAdmin?: boolean;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const visible =
    filter === "All" ? videos : videos.filter((v) => v.category === filter);

  return (
    <>
      <div className="section-header">
        <div>
          <h2>Session Library</h2>
          <p>Access recordings of all past sessions</p>
        </div>
        <div
          className="filter-row"
          style={{ margin: 0, alignItems: "center", gap: 8 }}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-btn${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "All" ? "All" : f}
            </button>
          ))}
          {isAdmin && <AdminAddChip href="/admin/videos" label="Add recording" />}
        </div>
      </div>

      <div className="library-grid">
        {visible.length === 0 ? (
          <div className="sessions-empty">No recordings in this category yet.</div>
        ) : (
          visible.map((v) => (
            <div key={v.id} style={{ position: "relative" }}>
              {isAdmin && (
                <span className="admin-chip-overlay">
                  <AdminEditChip href={`/admin/videos?edit=${v.id}`} />
                </span>
              )}
            <Link href={`/library/${v.id}`} className="recording-card">
              <div className="recording-thumb" style={{ background: v.gradient }}>
                {v.minAccess === "vip_plus" && (
                  <span className="recording-vip">VIP</span>
                )}
                {v.minAccess === "pro_only" && (
                  <span className="recording-vip">PRO</span>
                )}
                <span className="recording-play-btn">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </span>
                {v.durationLabel && (
                  <span className="recording-duration">{v.durationLabel}</span>
                )}
              </div>
              <div className="recording-body">
                <div className="recording-title">{v.title}</div>
                <div className="recording-meta">
                  <span className="recording-speaker">{v.speakerName}</span>
                  <span className="recording-date">{v.dateLabel}</span>
                </div>
              </div>
            </Link>
            </div>
          ))
        )}
      </div>
    </>
  );
}
