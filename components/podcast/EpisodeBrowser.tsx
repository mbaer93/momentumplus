"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EpisodeProgress, PodcastEpisode } from "@/lib/podcast";
import {
  saveEpisodeNote,
  setEpisodeCompleted,
  submitPodcastQuestion,
} from "@/app/(portal)/branching-out/actions";

/* Member-facing Branching Out browser (Matt, 2026-08-05): season tabs,
   follow/share block, green check when an episode is finished (the
   player's ended event, plus a manual toggle for people who listen on
   Spotify or in the car), private per-episode notes, and an "ask it on
   the air" submission box. */

// Minimal surface of YouTube's IFrame API — attached to the existing
// embeds (enablejsapi=1) so the ended event can mark episodes complete.
interface YtPlayerCtor {
  new (
    el: HTMLIFrameElement,
    opts: { events: { onStateChange?: (e: { data: number }) => void } },
  ): unknown;
}
declare global {
  interface Window {
    YT?: { Player: YtPlayerCtor };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Stroke-only green check-in-circle — the "you finished this" badge. */
function CompletedCheck() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent-green)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Episode completed"
      role="img"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
    </svg>
  );
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

/** Debounced-autosave private notes, mirroring the Library's editor. */
function EpisodeNotes({
  episodeId,
  initialNote,
}: {
  episodeId: string;
  initialNote: string;
}) {
  const [value, setValue] = useState(initialNote);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialNote);

  const save = useCallback(
    async (body: string) => {
      if (body === lastSaved.current) return;
      setStatus("Saving…");
      let res: Awaited<ReturnType<typeof saveEpisodeNote>>;
      try {
        res = await saveEpisodeNote(episodeId, body);
      } catch {
        res = { ok: false, message: "Couldn't reach the server — try again." };
      }
      if (res.ok) {
        lastSaved.current = body;
        setStatus(res.preview ? "Saved (preview mode)" : "Saved");
      } else {
        setStatus(res.message ?? "Could not save");
      }
    },
    [episodeId],
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, save]);

  return (
    <div>
      <textarea
        className="notes-area"
        style={{ minHeight: 80 }}
        placeholder="Your private notes on this episode. Only you can see these."
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus("");
        }}
        onBlur={() => void save(value)}
      />
      <div className="notes-status">{status}</div>
    </div>
  );
}

/** "Ask it on the air" — questions, challenges, Leadership Unscripted. */
function AskTheShow() {
  const [kind, setKind] = useState("question");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [sending, setSending] = useState(false);

  return (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 20 }}>
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 15.5,
          fontWeight: 700,
          marginBottom: 2,
        }}
      >
        Ask it on the air
      </div>
      <div
        style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}
      >
        Send a question for a guest, a leadership challenge you&apos;re
        facing, or a Leadership Unscripted question — we may bring it up on
        a future episode.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="What are you sending in?"
          style={{
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 13,
            background: "var(--cream)",
          }}
        >
          <option value="question">Question for a guest</option>
          <option value="challenge">Leadership challenge</option>
          <option value="unscripted">Leadership Unscripted</option>
        </select>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setStatus(null);
          }}
          placeholder="What should we ask?"
          rows={2}
          style={{
            flex: "1 1 260px",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 13,
            background: "var(--cream)",
            resize: "vertical",
          }}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={sending || !body.trim()}
          onClick={async () => {
            setSending(true);
            let res: Awaited<ReturnType<typeof submitPodcastQuestion>>;
            try {
              res = await submitPodcastQuestion(kind, body);
            } catch {
              res = { ok: false, message: "Couldn't reach the server — try again." };
            }
            setSending(false);
            setStatus({
              ok: res.ok,
              text:
                res.message ??
                (res.ok ? "Sent — thanks!" : "Something went wrong"),
            });
            if (res.ok) setBody("");
          }}
        >
          {sending ? "Sending…" : "Send it in"}
        </button>
      </div>
      {status && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12.5,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}

export function EpisodeBrowser({
  episodes,
  channelId,
  spotifyUrl,
  progress,
}: {
  episodes: PodcastEpisode[];
  channelId: string;
  spotifyUrl: string;
  progress: EpisodeProgress[];
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

  // Facade pattern: 100+ live YouTube players make the page crawl, so each
  // card starts as a lazy thumbnail + play button and the real player is
  // created only when clicked (autoplay picks up where the tap intended).
  const [activatedIds, setActivatedIds] = useState<Set<string>>(new Set());
  const activate = useCallback((episodeId: string) => {
    setActivatedIds((prev) => {
      if (prev.has(episodeId)) return prev;
      const copy = new Set(prev);
      copy.add(episodeId);
      return copy;
    });
  }, []);

  const [completedIds, setCompletedIds] = useState<Set<string>>(
    () => new Set(progress.filter((p) => p.completed).map((p) => p.episodeId)),
  );
  // Ref mirror so the callbacks read CURRENT state, never a deferred
  // updater's side effect (React may defer updater functions, which once
  // let the toggle save the wrong value — the check then vanished on
  // refresh because the database row said not-completed).
  const completedIdsRef = useRef(completedIds);
  completedIdsRef.current = completedIds;
  const [saveError, setSaveError] = useState<string | null>(null);
  const notesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of progress) m.set(p.episodeId, p.notes);
    return m;
  }, [progress]);

  const persistCompleted = useCallback(
    async (episodeId: string, next: boolean) => {
      setSaveError(null);
      setCompletedIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(episodeId);
        else copy.delete(episodeId);
        return copy;
      });
      let res: Awaited<ReturnType<typeof setEpisodeCompleted>>;
      try {
        res = await setEpisodeCompleted(episodeId, next);
      } catch {
        // The call never reached the action (deploy skew, network) — the
        // rejection used to vanish and leave a check the database never got.
        res = {
          ok: false,
          message: "Couldn't reach the server — refresh the page and try again.",
        };
      }
      if (!res.ok) {
        // Revert the optimistic check and say why, instead of showing a
        // green check that a refresh would take away.
        setCompletedIds((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(episodeId);
          else copy.add(episodeId);
          return copy;
        });
        setSaveError(res.message ?? "Couldn't save that — try again.");
      }
    },
    [],
  );

  const toggleCompleted = useCallback(
    (episodeId: string) =>
      persistCompleted(episodeId, !completedIdsRef.current.has(episodeId)),
    [persistCompleted],
  );

  const markEnded = useCallback(
    async (episodeId: string) => {
      if (completedIdsRef.current.has(episodeId)) return;
      await persistCompleted(episodeId, true);
    },
    [persistCompleted],
  );

  // --- YouTube IFrame API: watch for the ended event on each embed. ---
  const [apiReady, setApiReady] = useState(false);
  // Attachment is tracked per ELEMENT (not per episode id): React re-runs
  // ref callbacks on re-render with the same element (skip), while a tab
  // switch remounts a fresh iframe that genuinely needs a new player.
  const attachedEls = useRef(new WeakSet<HTMLIFrameElement>());
  const pendingIframes = useRef(new Map<string, HTMLIFrameElement>());

  useEffect(() => {
    if (window.YT?.Player) {
      setApiReady(true);
      return;
    }
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      setApiReady(true);
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  }, []);

  const attachPlayers = useCallback(() => {
    const YT = window.YT;
    if (!YT?.Player) return;
    for (const [episodeId, el] of pendingIframes.current) {
      if (attachedEls.current.has(el) || !el.isConnected) continue;
      attachedEls.current.add(el);
      try {
        new YT.Player(el, {
          events: {
            onStateChange: (e) => {
              if (e.data === 0) void markEnded(episodeId); // 0 = ended
            },
          },
        });
      } catch {
        /* a failed attach only loses auto-complete for that card */
      }
    }
  }, [markEnded]);

  useEffect(() => {
    if (apiReady) attachPlayers();
  }, [apiReady, tab, attachPlayers]);

  const iframeRef = useCallback(
    (episodeId: string) => (el: HTMLIFrameElement | null) => {
      if (!el) {
        pendingIframes.current.delete(episodeId);
        return;
      }
      pendingIframes.current.set(episodeId, el);
      if (apiReady) attachPlayers();
    },
    [apiReady, attachPlayers],
  );

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

      <AskTheShow />

      {saveError && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 4,
            fontSize: 13,
            border: "1px solid rgba(155,60,60,0.4)",
            color: "#9B3C3C",
            background: "rgba(155,60,60,0.06)",
            marginBottom: 16,
          }}
        >
          {saveError}
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
            const completed = completedIds.has(ep.id);
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
                  ) : activatedIds.has(ep.id) ? (
                    <iframe
                      ref={iframeRef(ep.id)}
                      src={`https://www.youtube-nocookie.com/embed/${ep.youtubeVideoId}?enablejsapi=1&autoplay=1`}
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => activate(ep.id)}
                      aria-label={`Play ${ep.title}`}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        padding: 0,
                        border: 0,
                        cursor: "pointer",
                        background: "var(--navy)",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumbnail; next/image adds nothing here */}
                      <img
                        src={
                          ep.thumbnailUrl ??
                          `https://i.ytimg.com/vi/${ep.youtubeVideoId}/hqdefault.jpg`
                        }
                        alt=""
                        loading="lazy"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 54,
                          height: 54,
                          borderRadius: "50%",
                          background: "rgba(11, 22, 34, 0.75)",
                          border: "1.5px solid var(--gold)",
                        }}
                      >
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--gold)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M8 5.5v13l11-6.5z" />
                        </svg>
                      </span>
                    </button>
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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11.5,
                        color: "var(--mid-gray)",
                      }}
                    >
                      {completed && <CompletedCheck />}
                      <span>
                        {dateLabel(ep.publishedAt)}
                        {ep.season !== null ? ` · Season ${ep.season}` : ""}
                      </span>
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
                  {!demo && (
                    <button
                      type="button"
                      className="btn-mini"
                      style={{ marginTop: 8 }}
                      onClick={() => void toggleCompleted(ep.id)}
                      title={
                        completed
                          ? "Un-mark this episode as listened"
                          : "Finished it on Spotify or in the car? Mark it here."
                      }
                    >
                      {completed ? "Listened" : "Mark as listened"}
                    </button>
                  )}
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
                  {!demo && (
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
                        My notes
                      </summary>
                      <div style={{ marginTop: 6 }}>
                        <EpisodeNotes
                          episodeId={ep.id}
                          initialNote={notesById.get(ep.id) ?? ""}
                        />
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
