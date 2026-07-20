"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionDetail } from "@/lib/types";
import { DocIcon, ExternalIcon } from "@/components/icons";
import { NotesEditor } from "./NotesEditor";

type Tab = "notes" | "resources" | "community";
type Phase =
  | "loading"
  | "joined"
  | "waiting"
  | "unavailable"
  | "ended"
  | "left";

/** Fit a 16:9 video canvas inside the stage. Sizing the Zoom panel to the
    stage's arbitrary shape stretched the video, parked it oddly, and pushed
    the toolbar (mute/camera/share) to the bottom edge where nobody saw it. */
function fitTo169(rect: { width: number; height: number } | undefined): {
  width: number;
  height: number;
} {
  const W = Math.max(320, Math.floor(rect?.width ?? 960));
  // Leave breathing room for the SDK toolbar below the video.
  const H = Math.max(240, Math.floor((rect?.height ?? 540) - 48));
  let width = W;
  let height = Math.floor((W * 9) / 16);
  if (height > H) {
    height = H;
    width = Math.floor((H * 16) / 9);
  }
  return { width, height };
}

/** Zoom's embedded SDK rejects with a plain object, not an Error — pull out
    the human reason and whether it just means "host hasn't started yet". */
function joinFailure(err: unknown): { text: string; notStarted: boolean } {
  const e = (err ?? {}) as {
    reason?: string;
    message?: string;
    errorCode?: number;
  };
  const text =
    e.reason || e.message || "Couldn't start the embedded room.";
  const notStarted =
    e.errorCode === 3008 || /not started|not begin/i.test(text);
  return { text, notStarted };
}

export function LiveRoom({
  session,
  displayName,
  memberEmail = "",
  canHost = false,
  viewerIsSpeaker = false,
}: {
  session: SessionDetail;
  displayName: string;
  memberEmail?: string;
  /** Admin or the session's own speaker: shows the host-start shortcut. */
  canHost?: boolean;
  /** The viewer IS this session's speaker — the intended host. Admins who
      aren't get a warning before starting as host. */
  viewerIsSpeaker?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("notes");
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string>("Connecting to the live room…");
  // Bumping `attempt` re-runs the join: automatically while waiting for the
  // host to start the meeting, or manually via the Try again button.
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const handledAttempt = useRef(-1);
  const initedRef = useRef(false);
  const clientRef = useRef<{
    updateVideoOptions?: (v: {
      viewSizes?: { default?: { width: number; height: number } };
    }) => void;
    leave?: () => Promise<void> | void;
  } | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Last applied video size — resize re-renders are SKIPPED unless the stage
  // genuinely changed (a mid-meeting re-render is what made screen shares
  // vanish and never come back).
  const lastSize = useRef<{ width: number; height: number } | null>(null);
  // Set when WE initiate the exit (Leave button / switching to the Zoom
  // app) so the SDK's Closed event doesn't overwrite the "left" state with
  // "session over".
  const leftDeliberately = useRef(false);

  /** Leave the embedded meeting (used by the Leave button and when opening
      the Zoom app — staying joined in both places duplicated the person). */
  const leaveEmbed = (nextPhase: Phase) => {
    leftDeliberately.current = true;
    try {
      void clientRef.current?.leave?.();
    } catch {
      /* already disconnected */
    }
    setPhase(nextPhase);
  };

  // Disconnect the stage observer only when the room unmounts (the join
  // effect re-runs per attempt, but the observer lives page-long).
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    },
    [],
  );

  useEffect(() => {
    // Guards React strict-mode double-invoke without blocking retries.
    if (handledAttempt.current >= attempt) return;
    handledAttempt.current = attempt;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const retrySoon = () => {
      // Auto-retry every 20s while the host hasn't started the meeting —
      // members who arrive early get connected the moment it begins.
      retryTimer = setTimeout(() => {
        if (!cancelled) setAttempt((a) => a + 1);
      }, 20_000);
    };

    async function join() {
      try {
        const res = await fetch("/api/zoom/signature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!cancelled) {
            setPhase("unavailable");
            setMessage(
              data.error ??
                "Live video isn't available right now. Use the Zoom app link to join.",
            );
          }
          return;
        }

        const { signature, sdkKey, meetingNumber, passcode } =
          (await res.json()) as {
            signature: string;
            sdkKey: string;
            meetingNumber: string;
            passcode?: string | null;
          };

        // Zoom Meeting SDK (component view) — loaded client-side only.
        const { default: ZoomMtgEmbedded } = await import(
          "@zoom/meetingsdk/embedded"
        );
        const client = ZoomMtgEmbedded.createClient();
        if (!rootRef.current || cancelled) return;

        // The client is a page-singleton: init once, join per attempt.
        if (!initedRef.current) {
          // Fit a 16:9 canvas inside the stage and size the mount box to
          // match — the SDK panel anchors to it, so the video sits centered
          // with its toolbar visible right below.
          const stage = rootRef.current.parentElement;
          const { width, height } = fitTo169(stage?.getBoundingClientRect());
          lastSize.current = { width, height };
          rootRef.current.style.width = `${width}px`;
          rootRef.current.style.height = `${height + 48}px`;
          await client.init({
            zoomAppRoot: rootRef.current,
            language: "en-US",
            patchJsMedia: true,
            customize: {
              video: {
                isResizable: false,
                // NOTE: no popper.disableDraggable — the SDK positions the
                // video panel through its drag layer, and disabling it drops
                // the panel to the viewport's top-left corner (off-stage).
                // Anchored + sized to the stage it reads as embedded anyway.
                viewSizes: { default: { width, height } },
                // Speaker view: whoever is talking fills the stage; during
                // a screen share the shared content takes the canvas with
                // the video strip alongside.
                defaultViewType: "speaker" as unknown as NonNullable<
                  NonNullable<
                    Parameters<typeof client.init>[0]["customize"]
                  >["video"]
                >["defaultViewType"],
              },
            },
          });
          initedRef.current = true;
          clientRef.current = client as typeof clientRef.current;
          // Follow the stage size: device rotations, window resizes, and
          // responsive breakpoints re-render the meeting to fit (debounced —
          // updateVideoOptions triggers a full SDK re-render).
          if (stage && typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => {
              if (resizeTimer.current) clearTimeout(resizeTimer.current);
              resizeTimer.current = setTimeout(() => {
                const next = fitTo169(stage.getBoundingClientRect());
                const prev = lastSize.current;
                // Re-rendering the SDK is disruptive (it broke screen
                // shares mid-meeting) — only do it for a real size change.
                if (
                  prev &&
                  Math.abs(prev.width - next.width) < 24 &&
                  Math.abs(prev.height - next.height) < 24
                ) {
                  return;
                }
                lastSize.current = next;
                if (rootRef.current) {
                  rootRef.current.style.width = `${next.width}px`;
                  rootRef.current.style.height = `${next.height + 48}px`;
                }
                try {
                  clientRef.current?.updateVideoOptions?.({
                    viewSizes: { default: next },
                  });
                } catch {
                  /* SDK mid-transition — the next resize event retries */
                }
              }, 400);
            });
            ro.observe(stage);
            observerRef.current = ro;
          }
          // When the host ends the meeting (or the member leaves), swap the
          // dead embed for a designed "session ended" state instead of a
          // black void. Ended-by-host also marks the session COMPLETED so
          // the platform agrees with what just happened in the room.
          try {
            (client as unknown as {
              on: (
                event: string,
                cb: (p: { state?: string; reason?: string }) => void,
              ) => void;
            }).on("connection-change", (payload) => {
              if (payload?.state !== "Closed") return;
              if (leftDeliberately.current) return; // we set the phase already
              const endedByHost = /ended by host|meeting has ended/i.test(
                payload?.reason ?? "",
              );
              if (endedByHost) {
                void fetch(`/api/sessions/${session.id}/complete`, {
                  method: "POST",
                }).catch(() => undefined);
              }
              setPhase("ended");
            });
          } catch {
            /* older SDKs without events keep the previous behavior */
          }
        }

        await client.join({
          sdkKey,
          signature,
          meetingNumber,
          userName: displayName,
          // Zoom accounts require passcodes by default; join fails without it.
          password: passcode ?? "",
          // Helps the attendance report match this participant to a member.
          userEmail: memberEmail || undefined,
        });

        leftDeliberately.current = false;
        if (!cancelled) setPhase("joined");
      } catch (err) {
        if (cancelled) return;
        const failure = joinFailure(err);
        if (failure.notStarted) {
          setPhase("waiting");
          setMessage(
            "The host hasn't started the session yet. Stay here — you'll be connected automatically the moment it begins.",
          );
          retrySoon();
        } else {
          setPhase("unavailable");
          setMessage(`Couldn't start the embedded room: ${failure.text}`);
        }
      }
    }

    void join();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [attempt, session.id, displayName, memberEmail]);

  return (
    <div className="live-wrap">
      <div className="live-topbar">
        <span className="live-dot" />
        <div>
          <div className="live-title">{session.title}</div>
          <div className="live-sub">
            {session.speaker.name} · Live on Momentum+
            {viewerIsSpeaker &&
              " · You host this session — joining here starts it under your name"}
          </div>
        </div>
        {phase === "joined" && (
          <button
            type="button"
            className="live-host-btn"
            style={{ cursor: "pointer" }}
            onClick={() => leaveEmbed("left")}
          >
            Leave session
          </button>
        )}
        {canHost && session.zoomMeetingId && (
          <a
            className="live-host-btn"
            href={`/api/sessions/${session.id}/start`}
            target="_blank"
            rel="noopener noreferrer"
            title={
              viewerIsSpeaker
                ? "Opens the Zoom app with full host controls — heads up: the Zoom app shows the shared account name, while hosting right here in the room shows YOUR name"
                : "The speaker is the intended host — start only if they can't"
            }
            onClick={(e) => {
              // The speaker hosts their own session; an admin starting it
              // can wrestle hosting away from them mid-prep.
              if (
                !viewerIsSpeaker &&
                !confirm(
                  "The session's speaker is the intended host. Starting as host yourself can take hosting away from them — only continue if there's an issue and the speaker can't start it. Start as host anyway?",
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            Start as host
          </a>
        )}
        {session.zoomJoinUrl && (
          <a
            className="live-fallback"
            href={session.zoomJoinUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              // Staying joined here AND in the Zoom app put the same person
              // in the meeting twice — leave the embed when they switch.
              if (phase === "joined") leaveEmbed("left");
            }}
          >
            Open in Zoom app instead
          </a>
        )}
      </div>

      <div className="live-body">
        <div className="live-stage">
          {/* Zoom Component View mounts here */}
          <div id="zoom-embed-root" ref={rootRef} />
          {phase !== "joined" && (
            <div className="live-placeholder">
              <span
                className={`live-ph-badge${
                  phase === "loading" || phase === "waiting" ? " pulsing" : ""
                }`}
              />
              <div className="live-ph-kicker">
                {phase === "loading"
                  ? "Connecting"
                  : phase === "waiting"
                    ? "Waiting for the host"
                    : phase === "ended"
                      ? "Session over"
                      : phase === "left"
                        ? "Stepped out"
                        : "Live room"}
              </div>
              <h3>
                {phase === "loading"
                  ? "Taking your seat…"
                  : phase === "waiting"
                    ? "Starting soon"
                    : phase === "ended"
                      ? "That's a wrap"
                      : phase === "left"
                        ? "You've left the room"
                        : "The room isn't live yet"}
              </h3>
              <p>
                {phase === "ended"
                  ? "The session has ended. The recording lands in the Library with AI takeaways, usually within a couple of days — and your notes are saved."
                  : phase === "left"
                    ? "You're out of the meeting here — if you switched to the Zoom app, you're still in the session there. Your notes are saved."
                    : message}
              </p>
              {(phase === "ended" || phase === "left") && (
                <p style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <a className="live-host-btn" href={`/sessions/${session.slug}`}>
                    Back to the session
                  </a>
                  <button
                    type="button"
                    className="live-fallback"
                    style={{ cursor: "pointer", background: "none" }}
                    onClick={() => window.location.reload()}
                  >
                    Rejoin
                  </button>
                </p>
              )}
              {phase === "unavailable" && (
                <p style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="live-fallback"
                    style={{ cursor: "pointer", background: "none" }}
                    onClick={() => {
                      setPhase("loading");
                      setMessage("Connecting to the live room…");
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Try again
                  </button>
                  {session.zoomJoinUrl && (
                    <a
                      className="live-fallback"
                      href={session.zoomJoinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Zoom app instead
                    </a>
                  )}
                </p>
              )}
              {canHost && phase === "unavailable" && !session.zoomMeetingId && (
                <p className="live-ph-hint">
                  Host note (members don&apos;t see this): this session has no
                  Zoom meeting attached — it was likely published before Zoom
                  was connected. Hit <strong>Publish</strong> on it again in
                  Admin → Sessions and the meeting is created automatically.
                </p>
              )}
            </div>
          )}
        </div>

        <aside className="live-side">
          <div className="live-tabs">
            <button
              className={`live-tab${tab === "notes" ? " active" : ""}`}
              onClick={() => setTab("notes")}
              type="button"
            >
              My Notes
            </button>
            <button
              className={`live-tab${tab === "resources" ? " active" : ""}`}
              onClick={() => setTab("resources")}
              type="button"
            >
              Resources
            </button>
            <button
              className={`live-tab${tab === "community" ? " active" : ""}`}
              onClick={() => setTab("community")}
              type="button"
            >
              Community
            </button>
          </div>

          <div className="live-pane">
            {tab === "notes" && (
              <NotesEditor sessionId={session.id} initialNote={session.note} />
            )}
            {tab === "resources" &&
              (session.resources.length === 0 ? (
                <div className="live-community-msg">
                  No resources shared for this session yet.
                </div>
              ) : (
                session.resources.map((r) => (
                  <div className="sess-resource-item" key={r.id}>
                    <div className="sess-resource-icon">
                      <DocIcon size={16} />
                    </div>
                    <div>
                      <div className="sess-resource-name">{r.name}</div>
                      <div className="sess-resource-type">{r.type}</div>
                    </div>
                    <a className="sess-resource-link" href={r.url}>
                      Open <ExternalIcon size={12} />
                    </a>
                  </div>
                ))
              ))}
            {tab === "community" && (
              <div className="live-community-msg">
                Chat with other members during the session in{" "}
                <a
                  href="/community"
                  target="_blank"
                  rel="noopener"
                  style={{ color: "var(--gold)" }}
                >
                  Community
                </a>{" "}
                — it opens in a new tab so you stay in the room. Zoom&apos;s
                own in-meeting chat works here too.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
