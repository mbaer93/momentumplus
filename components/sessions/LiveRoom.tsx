"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionDetail } from "@/lib/types";
import { DocIcon, ExternalIcon } from "@/components/icons";
import { NotesEditor } from "./NotesEditor";

type Tab = "notes" | "resources" | "community";
type Phase = "loading" | "joined" | "unavailable" | "ended";

export function LiveRoom({
  session,
  displayName,
  memberEmail = "",
  canHost = false,
}: {
  session: SessionDetail;
  displayName: string;
  memberEmail?: string;
  /** Admin or the session's own speaker: shows the host-start shortcut. */
  canHost?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("notes");
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string>("Connecting to the live room…");
  const rootRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

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

        await client.init({
          zoomAppRoot: rootRef.current,
          language: "en-US",
          patchJsMedia: true,
        });
        // When the host ends the meeting (or the member leaves), swap the
        // dead embed for a designed "session ended" state instead of a
        // black void.
        try {
          (client as unknown as {
            on: (event: string, cb: (p: { state?: string }) => void) => void;
          }).on("connection-change", (payload) => {
            if (!cancelled && payload?.state === "Closed") setPhase("ended");
          });
        } catch {
          /* older SDKs without events keep the previous behavior */
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

        if (!cancelled) setPhase("joined");
      } catch (err) {
        if (!cancelled) {
          setPhase("unavailable");
          setMessage(
            err instanceof Error
              ? `Couldn't start the embedded room: ${err.message}`
              : "Couldn't start the embedded room.",
          );
        }
      }
    }

    void join();
    return () => {
      cancelled = true;
    };
  }, [session.id, displayName, memberEmail]);

  return (
    <div className="live-wrap">
      <div className="live-topbar">
        <span className="live-dot" />
        <div>
          <div className="live-title">{session.title}</div>
          <div className="live-sub">
            {session.speaker.name} · Live on Momentum+
          </div>
        </div>
        {canHost && session.zoomMeetingId && (
          <a
            className="live-host-btn"
            href={`/api/sessions/${session.id}/start`}
            target="_blank"
            rel="noopener noreferrer"
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
                className={`live-ph-badge${phase === "loading" ? " pulsing" : ""}`}
              />
              <div className="live-ph-kicker">
                {phase === "loading"
                  ? "Connecting"
                  : phase === "ended"
                    ? "Session over"
                    : "Live room"}
              </div>
              <h3>
                {phase === "loading"
                  ? "Taking your seat…"
                  : phase === "ended"
                    ? "That's a wrap"
                    : "The room isn't live yet"}
              </h3>
              <p>
                {phase === "ended"
                  ? "The session has ended. The recording lands in the Library with AI takeaways, usually within a couple of days — and your notes are saved."
                  : message}
              </p>
              {phase === "ended" && (
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
              {phase === "unavailable" && session.zoomJoinUrl && (
                <p style={{ marginTop: 14 }}>
                  <a
                    className="live-fallback"
                    href={session.zoomJoinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Zoom app instead
                  </a>
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
