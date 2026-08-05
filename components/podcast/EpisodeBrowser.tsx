"use client";

import { useMemo, useState } from "react";
import type { PodcastEpisode } from "@/lib/podcast";

/* Member-facing Branching Out browser (Matt, 2026-08-05): season tabs so
   episodes are easy to find, and a follow/share block so members help the
   show grow. Season tabs appear only once any episode has a season;
   unassigned episodes group under "Extras". */

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function ShareButton({ ep }: { ep: PodcastEpisode }) {
  const [copied, setCopied] = useState(false);
  const url = `https://www.youtube.com/watch?v=${ep.youtubeVideoId}`;
  return (
    <button
      type="button"
      className="btn-mini"
      onClick={async () => {
        // Native share sheet on phones; clipboard everywhere else.
        try {
          if (navigator.share) {
            await navigator.share({ title: ep.title, url });
            return;
          }
        } catch {
          /* user closed the sheet — fall through to copy */
        }
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy the episode link:", url);
        }
      }}
    >
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

export function EpisodeBrowser({
  episodes,
  channelId,
  spotifyUrl,
}: {
  episodes: PodcastEpisode[];
  channelId: string;
  spotifyUrl: string;
}) {
  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const ep of episodes) {
      if (ep.season !== null) set.add(ep.season);
    }
    return [...set].sort((a, b) => b - a); // newest season first
  }, [episodes]);
  const hasExtras = episodes.some((ep) => ep.season === null);

  type Tab = "all" | number | "extras";
  const [tab, setTab] = useState<Tab>("all");

  const visible = episodes.filter((ep) => {
    if (tab === "all") return true;
    if (tab === "extras") return ep.season === null;
    return ep.season === tab;
  });

  const youtubeUrl = channelId
    ? `https://www.youtube.com/channel/${channelId}?sub_confirmation=1`
    : "";

  return (
    <>
      {/* Follow the show — subscribing and sharing is how it grows. */}
      {(youtubeUrl || spotifyUrl) && (
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            padding: "14px 18px",
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 15.5,
                fontWeight: 700,
              }}
            >
              Enjoying Branching Out?
            </div>
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
              Liking, following, and sharing episodes is the biggest way to
              help the show grow.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {youtubeUrl && (
              <a
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                Subscribe on YouTube
              </a>
            )}
            {spotifyUrl && (
              <a
                href={spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                Follow on Spotify
              </a>
            )}
          </div>
        </div>
      )}

      {/* Season tabs — only once seasons exist. */}
      {seasons.length > 0 && (
        <div className="filter-row" style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={`filter-btn${tab === "all" ? " active" : ""}`}
            onClick={() => setTab("all")}
          >
            All Episodes
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              type="button"
              className={`filter-btn${tab === s ? " active" : ""}`}
              onClick={() => setTab(s)}
            >
              Season {s}
            </button>
          ))}
          {hasExtras && (
            <button
              type="button"
              className={`filter-btn${tab === "extras" ? " active" : ""}`}
              onClick={() => setTab("extras")}
            >
              Extras
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="sessions-empty">No episodes here yet.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 20,
          }}
        >
          {visible.map((ep) => {
            const demo = ep.youtubeVideoId.startsWith("demo-");
            return (
              <div key={ep.id} className="card" style={{ overflow: "hidden" }}>
                <div
                  style={{
                    position: "relative",
                    aspectRatio: "16 / 9",
                    background: "var(--navy)",
                  }}
                >
                  {demo ? (
                    // Preview mode: a styled stand-in instead of a dead embed.
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--gold)",
                        fontFamily: "'Playfair Display', serif",
                        fontSize: 22,
                      }}
                    >
                      Branching Out
                    </div>
                  ) : (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${ep.youtubeVideoId}`}
                      title={ep.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        border: 0,
                      }}
                    />
                  )}
                </div>
                <div style={{ padding: "14px 16px 16px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                      {dateLabel(ep.publishedAt)}
                      {ep.season !== null ? ` · Season ${ep.season}` : ""}
                    </div>
                    {!demo && <ShareButton ep={ep} />}
                  </div>
                  <h3
                    style={{
                      fontFamily: "'Playfair Display', serif",
                      fontSize: 16.5,
                      lineHeight: 1.35,
                      margin: 0,
                    }}
                  >
                    {ep.title}
                  </h3>
                  {ep.showNotes && (
                    <details style={{ marginTop: 8 }}>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--gold)",
                          listStyle: "none",
                        }}
                      >
                        Show notes
                      </summary>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: "var(--mid-gray)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {ep.showNotes}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
