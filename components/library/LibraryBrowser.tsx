"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { VideoItem } from "@/lib/videos/data";
import type { Topic } from "@/lib/topics";
import { AdminAddChip, AdminEditChip } from "@/components/admin/AdminChips";

export function LibraryBrowser({
  videos,
  topics,
  isAdmin = false,
}: {
  videos: VideoItem[];
  /* Sierra's taxonomy, straight from content_topics — new speakers bring new
     topics and this row picks them up without a deploy. */
  topics: Topic[];
  isAdmin?: boolean;
}) {
  const [filter, setFilter] = useState<string>("all");

  // Only offer topics something is actually filed under; an empty chip is a
  // dead end, and the taxonomy runs ahead of the content.
  const used = new Set(videos.flatMap((v) => v.topics.map((t) => t.slug)));
  const filters = [
    { slug: "all", name: "All" },
    ...topics.filter((t) => used.has(t.slug)),
  ];

  const visible =
    filter === "all"
      ? videos
      : videos.filter((v) => v.topics.some((t) => t.slug === filter));

  return (
    <>
      <div className="section-header">
        <div>
          <h2>Session Library</h2>
          <p>
            Recordings of every past session, with AI takeaways and your
            private notes
          </p>
        </div>
        <div
          className="filter-row"
          style={{ margin: 0, alignItems: "center", gap: 8 }}
        >
          {filters.map((f) => (
            <button
              key={f.slug}
              type="button"
              className={`filter-btn${filter === f.slug ? " active" : ""}`}
              aria-pressed={filter === f.slug}
              onClick={() => setFilter(f.slug)}
            >
              {f.name}
            </button>
          ))}
          {isAdmin && <AdminAddChip href="/admin/videos" label="Add recording" />}
        </div>
      </div>

      <div className="library-grid">
        {visible.length === 0 ? (
          <div className="sessions-empty">No recordings on this topic yet.</div>
        ) : (
          visible.map((v) => (
            <div key={v.id} style={{ position: "relative" }}>
              {isAdmin && (
                <span className="admin-chip-overlay">
                  <AdminEditChip href={`/admin/videos?edit=${v.id}`} />
                </span>
              )}
            {/* Locked recordings link to the upgrade path (a real /library
                page would 404 for them) and never render a play button. */}
            <Link
              href={v.locked ? "/upgrade" : `/library/${v.id}`}
              className={`recording-card${v.locked ? " locked" : ""}`}
            >
              <div className="recording-thumb" style={{ background: v.gradient }}>
                {v.thumbnailUrl && (
                  <Image
                    src={v.thumbnailUrl}
                    alt=""
                    className="recording-thumb-img"
                    fill
                    sizes="(max-width: 640px) 100vw, 360px"
                  />
                )}
                {v.minAccess === "vip_plus" && (
                  <span className="recording-vip">EXCLUSIVE</span>
                )}
                {v.minAccess === "pro_only" && (
                  <span className="recording-vip">PRO</span>
                )}
                {v.locked ? (
                  <span className="recording-lock" aria-hidden>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                ) : (
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
                )}
                {v.durationLabel && !v.locked && (
                  <span className="recording-duration">{v.durationLabel}</span>
                )}
              </div>
              <div className="recording-body">
                <div className="recording-title">{v.title}</div>
                {v.topics.length > 0 && (
                  <div className="recording-topics">
                    {v.topics.slice(0, 2).map((t) => (
                      <span
                        key={t.slug}
                        className={`recording-topic${t.isPrimary ? " primary" : ""}`}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="recording-meta">
                  <span className="recording-speaker">{v.speakerName}</span>
                  {v.locked ? (
                    <span className="recording-date" style={{ color: "var(--gold-text)" }}>
                      {v.lockReason === "season"
                        ? "Past season — upgrade to watch"
                        : "Upgrade to watch"}
                    </span>
                  ) : (
                    <span className="recording-date">{v.dateLabel}</span>
                  )}
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
