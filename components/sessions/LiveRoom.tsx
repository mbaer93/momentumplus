"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/*
 * The live room runs Zoom's CLIENT VIEW — the full Zoom web client, exactly
 * what members get joining a meeting in a browser: full-size toolbar,
 * self-view, native screen-share handling (share appears and the video comes
 * back when it stops), centered dialogs, gallery/speaker toggle.
 *
 * We previously embedded the SDK's "component view" floating panel; its
 * tiny toolbar, off-screen consent dialogs, share blackouts, and unbounded
 * canvas were unfixable from outside the SDK. The client view takes the
 * whole viewport while the meeting runs (leaving returns to this page), so
 * member notes live in a floating drawer on top of it.
 */

const SDK_VERSION = "6.2.0";

/** Zoom rejects with a plain object, not an Error — pull out the human
    reason and whether it just means "host hasn't started yet". */
function joinFailure(err: unknown): { text: string; notStarted: boolean } {
  const e = (err ?? {}) as {
    reason?: string;
    message?: string;
    errorMessage?: string;
    errorCode?: number;
  };
  const text =
    e.reason || e.errorMessage || e.message || "Couldn't start the live room.";
  const notStarted =
    e.errorCode === 3008 || /not started|not begin/i.test(text);
  return { text, notStarted };
}

/** The client view mounts into a #zmmtg-root on <body>; create it hidden. */
function ensureZoomRoot(): HTMLElement {
  let root = document.getElementById("zmmtg-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "zmmtg-root";
    document.body.appendChild(root);
  }
  root.style.display = "none";
  return root;
}

/** The client view's styles ship from Zoom's CDN (the npm package carries
    only the JS); load them once alongside the SDK. */
function ensureZoomStyles() {
  for (const file of ["bootstrap.css", "react-select.css"]) {
    const href = `https://source.zoom.us/${SDK_VERSION}/css/${file}`;
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }
}

export function LiveRoom({
  session,
  displayName,
  memberEmail = "",
  canHost = false,
  viewerIsSpeaker = false,
  startedAsLeft = false,
}: {
  session: SessionDetail;
  displayName: string;
  memberEmail?: string;
  /** Admin or the session's own speaker: shows the host-start shortcut. */
  canHost?: boolean;
  /** The viewer IS this session's speaker — the intended host. Admins who
      aren't get a warning before starting as host. */
  viewerIsSpeaker?: boolean;
  /** True when Zoom's leave button brought us back here (?left=1) — show
      the "you've left" state instead of instantly re-joining. */
  startedAsLeft?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("notes");
  const [phase, setPhase] = useState<Phase>(startedAsLeft ? "left" : "loading");
  const [message, setMessage] = useState<string>("Connecting to the live room…");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumping `attempt` re-runs the join: automatically while waiting for the
  // host to start the meeting, or manually via the Try again button.
  const [attempt, setAttempt] = useState(0);
  // Set when the member deliberately steps out (Zoom app / hosting from the
  // app) — stops the auto-retry loop from dragging them back in and
  // duplicating them in the meeting.
  const suspendedRef = useRef(startedAsLeft);
  const handledAttempt = useRef(-1);
  const initedRef = useRef(false);
  const leftDeliberately = useRef(false);
  const zoomRef = useRef<{
    leaveMeeting: (args: { success?: () => void; error?: () => void }) => void;
  } | null>(null);

  /** Deliberately step out: leave the meeting if joined, stop retries, and
      show the "left" state. Used when switching to the Zoom app — staying
      connected in both places put the same person in the meeting twice. */
  const stepOut = (msg: string) => {
    leftDeliberately.current = true;
    suspendedRef.current = true;
    try {
      zoomRef.current?.leaveMeeting({});
    } catch {
      /* not in a meeting */
    }
    const root = document.getElementById("zmmtg-root");
    if (root) root.style.display = "none";
    setMessage(msg);
    setPhase("left");
  };

  useEffect(() => {
    if (suspendedRef.current) return;
    // Guards React strict-mode double-invoke without blocking retries.
    if (handledAttempt.current >= attempt) return;
    handledAttempt.current = attempt;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const retrySoon = () => {
      // Auto-retry every 20s while the host hasn't started the meeting —
      // members who arrive early get connected the moment it begins.
      retryTimer = setTimeout(() => {
        if (!cancelled && !suspendedRef.current) setAttempt((a) => a + 1);
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

        const { signature, meetingNumber, passcode, zak } =
          (await res.json()) as {
            signature: string;
            meetingNumber: string;
            passcode?: string | null;
            /** Present for the intended host — lets their join START the
                meeting under their own display name. */
            zak?: string | null;
          };

        const { ZoomMtg } = await import("@zoom/meetingsdk");
        if (cancelled) return;
        zoomRef.current = ZoomMtg as unknown as typeof zoomRef.current;

        const root = ensureZoomRoot();

        if (!initedRef.current) {
          ensureZoomStyles();
          ZoomMtg.setZoomJSLib(
            `https://source.zoom.us/${SDK_VERSION}/lib`,
            "/av",
          );
          ZoomMtg.preLoadWasm();
          ZoomMtg.prepareWebSDK();
          await new Promise<void>((resolve, reject) => {
            ZoomMtg.init({
              // Zoom's own Leave button brings the member back here in the
              // "left" state instead of instantly re-joining them.
              leaveUrl: `${window.location.pathname}?left=1`,
              patchJsMedia: true,
              disableInvite: true,
              success: () => resolve(),
              error: (e: unknown) => reject(e),
            });
          });
          // When the meeting ends (host ends for all, or a drop), tell the
          // server — it verifies with the Zoom API and only completes the
          // session if the meeting truly ended, so blips can't mislabel it.
          try {
            ZoomMtg.inMeetingServiceListener(
              "onMeetingStatus",
              (data: { meetingStatus?: number }) => {
                if (data?.meetingStatus !== 3) return; // 3 = disconnected
                if (leftDeliberately.current) return;
                // keepalive: the SDK navigates to leaveUrl right after this.
                void fetch(`/api/sessions/${session.id}/complete`, {
                  method: "POST",
                  keepalive: true,
                }).catch(() => undefined);
              },
            );
          } catch {
            /* the hourly cron completes ended sessions regardless */
          }
          initedRef.current = true;
        }

        // Visible from the join call on — the SDK shows its device preview
        // (pick camera/mic, see yourself) before entering the meeting.
        root.style.display = "block";

        await new Promise<void>((resolve, reject) => {
          ZoomMtg.join({
            signature,
            meetingNumber,
            userName: displayName,
            // Zoom accounts require passcodes by default; join fails without.
            passWord: passcode ?? "",
            // Helps the attendance report match this participant to a member.
            userEmail: memberEmail || undefined,
            // Intended host only: authorizes STARTING the meeting.
            ...(zak ? { zak } : {}),
            success: () => resolve(),
            error: (e: unknown) => reject(e),
          });
        });

        leftDeliberately.current = false;
        if (!cancelled) setPhase("joined");
      } catch (err) {
        const root = document.getElementById("zmmtg-root");
        if (root) root.style.display = "none";
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
          setMessage(`Couldn't start the live room: ${failure.text}`);
        }
      }
    }

    void join();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [attempt, session.id, displayName, memberEmail]);

  // Hide Zoom's root if the member navigates away inside the app while the
  // meeting UI is up (client-side route change unmounts us, not the page).
  useEffect(
    () => () => {
      const root = document.getElementById("zmmtg-root");
      if (root) root.style.display = "none";
    },
    [],
  );

  const sidePanel = (
    <>
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
            — it opens in a new tab so you stay in the room. Zoom&apos;s own
            in-meeting chat works here too.
          </div>
        )}
      </div>
    </>
  );

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
        {canHost && session.zoomMeetingId && (
          <a
            className="live-host-btn"
            style={{ marginLeft: "auto" }}
            href={`/api/sessions/${session.id}/start`}
            target="_blank"
            rel="noopener noreferrer"
            title={
              "Opens the Zoom app with full host controls — heads up: the Zoom app always shows the shared account's name. Hosting right here in the room shows YOUR name." +
              (viewerIsSpeaker
                ? ""
                : " The speaker is the intended host — start only if they can't.")
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
                return;
              }
              // Hosting from the Zoom app while this page keeps (re)joining
              // put the host in the meeting twice — step out here first.
              stepOut(
                "You're hosting from the Zoom app — this page has stepped out of the meeting so you're not in it twice. Your notes are saved.",
              );
            }}
          >
            Start as host
          </a>
        )}
        {session.zoomJoinUrl && (
          <a
            className="live-fallback"
            style={canHost && session.zoomMeetingId ? { marginLeft: 0 } : undefined}
            href={session.zoomJoinUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              stepOut(
                "You've switched to the Zoom app — this page has stepped out of the meeting so you're not in it twice. Your notes are saved.",
              )
            }
          >
            Open in Zoom app instead
          </a>
        )}
      </div>

      <div className="live-body">
        <div className="live-stage">
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
                  : phase === "left" && !message.startsWith("You")
                    ? "You're out of the meeting here. If you switched to the Zoom app, you're still in the session there. Your notes are saved."
                    : message}
              </p>
              {(phase === "ended" || phase === "left") && (
                <p style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <a className="live-host-btn" href={`/sessions/${session.slug}`}>
                    Back to the session
                  </a>
                  {phase === "left" && (
                    <a
                      className="live-fallback"
                      style={{ marginLeft: 0 }}
                      href={`/sessions/${session.slug}/live`}
                    >
                      Rejoin
                    </a>
                  )}
                </p>
              )}
              {phase === "unavailable" && (
                <p style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="live-fallback"
                    style={{ cursor: "pointer", background: "none", marginLeft: 0 }}
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
                      style={{ marginLeft: 0 }}
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

        <aside className="live-side">{sidePanel}</aside>
      </div>

      {/* While the meeting is up, the Zoom client covers the whole screen —
          notes ride on top of it in a drawer (portaled to <body> so no
          ancestor stacking context can bury it under Zoom's UI). */}
      {phase === "joined" &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <button
              type="button"
              className="live-drawer-btn"
              onClick={() => setDrawerOpen((o) => !o)}
            >
              {drawerOpen ? "Close" : "My Notes"}
            </button>
            {drawerOpen && <div className="live-drawer">{sidePanel}</div>}
          </>,
          document.body,
        )}
    </div>
  );
}
