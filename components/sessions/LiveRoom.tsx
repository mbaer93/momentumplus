"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionDetail } from "@/lib/types";
import { DocIcon, ExternalIcon } from "@/components/icons";
import { NotesEditor } from "./NotesEditor";

type Tab = "notes" | "resources" | "community";
type Phase =
  | "choose"
  | "loading"
  | "joined"
  | "waiting"
  | "unavailable"
  | "left";

/*
 * The live room runs Zoom's CLIENT VIEW — the full Zoom web client, exactly
 * what members get joining a meeting in a browser: full-size toolbar,
 * self-view, native screen-share handling, centered dialogs, gallery/speaker
 * toggle. The client view takes the whole viewport while the meeting runs
 * (leaving returns to this page), so member notes live in a floating drawer
 * on top of it.
 *
 * IMPORTANT: every entry INTO a live room is a full document load (plain
 * <a>, not <Link>) — the SharedArrayBuffer isolation headers on this route
 * only apply on a document response, and a fresh document also guarantees
 * the Zoom singleton below is initialized for THIS session (leaveUrl, the
 * status listener). Keep it that way.
 */

const SDK_VERSION = "6.2.0";

/** The generic stepped-out copy. Zoom sends everyone to ?left=1 for BOTH
    cases — leaving yourself and the host ending the meeting — and we can't
    tell which, so the copy covers both. */
const LEFT_GENERIC =
  "Either you left, or the host ended the session for everyone. If it's still running you can rejoin below — and if it's over, the recording lands in the Library with AI takeaways. Your notes are saved either way.";

/* ---- Zoom is a page-wide singleton; so is our bookkeeping about it. ----
   The SDK's onMeetingStatus listener can't be unregistered, so it is
   registered ONCE and routed through this mutable pointer to whichever
   room instance is active. */
interface ActiveRoom {
  sessionId: string;
  pathname: string;
  isJoined: () => boolean;
  isDeliberate: () => boolean;
}
let zoomBooted = false;
let activeRoom: ActiveRoom | null = null;
let disconnectNavTimer: ReturnType<typeof setTimeout> | undefined;

function cancelDisconnectNav() {
  if (disconnectNavTimer) {
    clearTimeout(disconnectNavTimer);
    disconnectNavTimer = undefined;
  }
}

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

function hideZoomRoot() {
  const root = document.getElementById("zmmtg-root");
  if (root) root.style.display = "none";
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
  // Admins choose how to join BEFORE we hand them to Zoom — once join() is
  // called, Zoom's own waiting-for-host page covers everything instantly,
  // so a button on our waiting screen was unclickable in practice.
  const askHowToJoin = canHost && !viewerIsSpeaker;
  const [phase, setPhase] = useState<Phase>(
    startedAsLeft ? "left" : askHowToJoin ? "choose" : "loading",
  );
  const [message, setMessage] = useState<string>(
    startedAsLeft ? LEFT_GENERIC : "Connecting to the live room…",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Host's force-end: marks the session completed on the platform without
  // waiting for Zoom's (sometimes laggy) end-of-meeting record.
  const [ending, setEnding] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  // Bumping `attempt` re-runs the join: automatically while waiting for the
  // host to start the meeting, or manually via the Try again button.
  const [attempt, setAttempt] = useState(0);
  // Set when the member deliberately steps out (Zoom app / hosting from the
  // app) — stops the auto-retry loop from dragging them back in and
  // duplicating them in the meeting.
  const suspendedRef = useRef(startedAsLeft || askHowToJoin);
  // Admins join as plain attendees unless they explicitly choose to host —
  // an admin account merely opening the page must never start the meeting.
  // (The speaker is the intended host; the server always host-joins them.)
  const hostIntentRef = useRef(false);
  // True only between a successful join and a leave/disconnect — the status
  // listener uses it to tell a real mid-meeting disconnect apart from the
  // SDK's status-3 noise on FAILED join attempts and transient errors.
  const joinedRef = useRef(false);
  const handledAttempt = useRef(-1);
  const leftDeliberately = useRef(false);
  const zoomRef = useRef<{
    leaveMeeting: (args: { success?: () => void; error?: () => void }) => void;
  } | null>(null);

  const leaveZoom = () => {
    joinedRef.current = false;
    try {
      zoomRef.current?.leaveMeeting({});
    } catch {
      /* not in a meeting */
    }
    hideZoomRoot();
  };

  /** Host says the meeting is over — flip the session to completed NOW,
      bypassing the Zoom end-record check (which can lag or hiccup). */
  const forceEndSession = async () => {
    if (
      !confirm(
        "Mark this session completed across the platform? Do this only after the meeting has actually ended for everyone.",
      )
    ) {
      return;
    }
    setEnding("working");
    try {
      const res = await fetch(`/api/sessions/${session.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        skipped?: string;
      } | null;
      setEnding(res.ok && json?.ok && !json.skipped ? "done" : "error");
    } catch {
      setEnding("error");
    }
  };

  /** Deliberately step out: leave the meeting if joined, stop retries, and
      show the "left" state. Used when switching to the Zoom app — staying
      connected in both places put the same person in the meeting twice. */
  const stepOut = (msg: string) => {
    leftDeliberately.current = true;
    suspendedRef.current = true;
    cancelDisconnectNav();
    leaveZoom();
    setMessage(msg);
    setPhase("left");
  };

  // Second shot at completion: the disconnect handler fires /complete the
  // instant the meeting ends, but Zoom only writes its end-of-meeting record
  // a few seconds later — so that first call can find nothing. Landing back
  // on this page (?left=1) is comfortably after the lag, so ask again.
  useEffect(() => {
    if (!startedAsLeft) return;
    void fetch(`/api/sessions/${session.id}/complete`, {
      method: "POST",
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          body: JSON.stringify({
            sessionId: session.id,
            asHost: hostIntentRef.current,
          }),
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

        // Point the singleton's status listener at THIS room.
        activeRoom = {
          sessionId: session.id,
          pathname: window.location.pathname,
          isJoined: () => joinedRef.current,
          isDeliberate: () => leftDeliberately.current,
        };

        const root = ensureZoomRoot();

        if (!zoomBooted) {
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
          // Registered ONCE per document (it can't be unregistered) and
          // routed through activeRoom. Status 3 (disconnected) also fires
          // on FAILED join attempts and recoverable blips, so it only
          // counts when we were actually joined — and a recovery signal
          // (2 connected / 4 reconnecting) cancels the pending exit.
          try {
            ZoomMtg.inMeetingServiceListener(
              "onMeetingStatus",
              (data: { meetingStatus?: number }) => {
                const s = data?.meetingStatus;
                if (s === 2 || s === 4) {
                  cancelDisconnectNav();
                  return;
                }
                if (s !== 3) return;
                const room = activeRoom;
                if (!room || !room.isJoined() || room.isDeliberate()) return;
                // Report the end — the server verifies with the Zoom API
                // (past-meeting record) before completing anything, so
                // spurious disconnects can't mislabel a running session.
                void fetch(`/api/sessions/${room.sessionId}/complete`, {
                  method: "POST",
                  keepalive: true,
                }).catch(() => undefined);
                // Don't rely on Zoom's "ended by host" dialog to move
                // people along — leave on our own. A recovery signal
                // before the timer fires cancels this.
                cancelDisconnectNav();
                disconnectNavTimer = setTimeout(() => {
                  window.location.href = `${room.pathname}?left=1`;
                }, 2000);
              },
            );
          } catch {
            /* the hourly cron completes ended sessions regardless */
          }
          zoomBooted = true;
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

        // The member may have stepped out (Zoom app) while this join was in
        // flight — honor that instead of silently re-entering them twice.
        if (suspendedRef.current) {
          leaveZoom();
          return;
        }

        joinedRef.current = true;
        leftDeliberately.current = false;
        if (!cancelled) setPhase("joined");
      } catch (err) {
        hideZoomRoot();
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
      // Release the attempt so a strict-mode remount (which re-runs this
      // effect with the same attempt number) can claim it again — without
      // this, dev builds deadlocked on "Taking your seat…".
      if (handledAttempt.current === attempt) {
        handledAttempt.current = attempt - 1;
      }
    };
  }, [attempt, session.id, displayName, memberEmail]);

  // On unmount (browser Back, in-app navigation) LEAVE the meeting — the
  // Zoom client lives on <body> outside React, so without this the member
  // stayed connected with a live mic and a hidden UI.
  useEffect(
    () => () => {
      cancelDisconnectNav();
      if (joinedRef.current) {
        leftDeliberately.current = true;
        leaveZoom();
      } else {
        hideZoomRoot();
      }
      activeRoom = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                {/* New tab — same-tab navigation dropped the member out of
                    the live meeting when opened from the in-meeting drawer. */}
                <a
                  className="sess-resource-link"
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                >
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
                {phase === "choose"
                  ? "Host controls"
                  : phase === "loading"
                    ? "Connecting"
                    : phase === "waiting"
                      ? "Waiting for the host"
                      : phase === "left"
                        ? "Stepped out"
                        : "Live room"}
              </div>
              <h3>
                {phase === "choose"
                  ? "How do you want to join?"
                  : phase === "loading"
                    ? "Taking your seat…"
                    : phase === "waiting"
                      ? "Starting soon"
                      : phase === "left"
                        ? "You're out of the meeting"
                        : "The room isn't live yet"}
              </h3>
              <p>
                {phase === "choose"
                  ? "Hosting from this room runs the meeting under YOUR name. The session's speaker is the intended host — host only if they can't. If the meeting is already running, you'll join it as an attendee either way."
                  : message}
              </p>
              {phase === "choose" && (
                <p style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="live-host-btn"
                    style={{ cursor: "pointer", border: "none" }}
                    onClick={() => {
                      hostIntentRef.current = true;
                      suspendedRef.current = false;
                      setPhase("loading");
                      setMessage("Starting the meeting as host…");
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Host from this room
                  </button>
                  <button
                    type="button"
                    className="live-fallback"
                    style={{ cursor: "pointer", background: "none", marginLeft: 0 }}
                    onClick={() => {
                      hostIntentRef.current = false;
                      suspendedRef.current = false;
                      setPhase("loading");
                      setMessage("Connecting to the live room…");
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Join as attendee
                  </button>
                </p>
              )}
              {phase === "left" && (
                <p style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <a className="live-host-btn" href={`/sessions/${session.slug}`}>
                    Back to the session
                  </a>
                  <a
                    className="live-fallback"
                    style={{ marginLeft: 0 }}
                    href={`/sessions/${session.slug}/live`}
                  >
                    Rejoin
                  </a>
                  {/* A recurring series never completes — next occurrence is next. */}
                  {canHost && !session.recurrence && session.status !== "completed" && (
                    <button
                      type="button"
                      className="live-fallback"
                      style={{ cursor: "pointer", background: "none", marginLeft: 0 }}
                      disabled={ending === "working" || ending === "done"}
                      title="If the session still shows as live after you've ended the meeting, this marks it completed immediately."
                      onClick={forceEndSession}
                    >
                      {ending === "done"
                        ? "Session marked completed"
                        : ending === "working"
                          ? "Ending…"
                          : ending === "error"
                            ? "Couldn't end — try again"
                            : "End session"}
                    </button>
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
