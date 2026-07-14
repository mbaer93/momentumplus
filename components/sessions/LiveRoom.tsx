"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SessionDetail } from "@/lib/types";
import { DocIcon, ExternalIcon } from "@/components/icons";
import { NotesEditor } from "./NotesEditor";

type Tab = "notes" | "resources" | "community";
type Phase = "loading" | "joined" | "unavailable";

export function LiveRoom({
  session,
  displayName,
}: {
  session: SessionDetail;
  displayName: string;
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

        const { signature, sdkKey, meetingNumber } = (await res.json()) as {
          signature: string;
          sdkKey: string;
          meetingNumber: string;
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
        await client.join({
          sdkKey,
          signature,
          meetingNumber,
          userName: displayName,
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
  }, [session.id, displayName]);

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
              <h3>{phase === "loading" ? "Joining…" : "Live room"}</h3>
              <p>{message}</p>
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
                The live session chat channel opens here once the community
                feature (Stream Chat) ships in Phase 4. For now, use{" "}
                <Link href="/community" style={{ color: "var(--gold)" }}>
                  Community
                </Link>{" "}
                to keep the conversation going.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
