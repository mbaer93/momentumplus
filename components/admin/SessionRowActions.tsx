"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cancelSession,
  deleteSession,
  importSessionRecording,
} from "@/app/(portal)/admin/sessions/actions";

export function SessionRowActions({
  sessionId,
  hasMeeting,
}: {
  sessionId: string;
  hasMeeting: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);
  // ok:false renders red — success and failure used to look identical here.
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  function onCancel() {
    if (
      !confirm(
        "Cancel this session? Members will see it marked Cancelled and enrollment closes, and the Zoom meeting is deleted so old calendar invites stop working. They are NOT notified automatically — send an announcement if they should hear about it.",
      )
    )
      return;
    startTransition(async () => {
      const res = await cancelSession(sessionId);
      setNote(
        res.message
          ? { text: res.message, ok: res.ok && !res.warning }
          : null,
      );
      if (res.ok) router.refresh();
    });
  }

  function onDelete() {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    startTransition(async () => {
      const res = await deleteSession(sessionId);
      setNote(
        res.preview && res.message ? { text: res.message, ok: true } : null,
      );
      if (res.ok) router.refresh();
      else setNote({ text: res.message ?? "Delete failed", ok: false });
    });
  }

  async function onPublish() {
    // In-flight guard: a double-click here would otherwise create TWO Zoom
    // meetings for the same session.
    if (publishing) return;
    setPublishing(true);
    setNote(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/publish`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        zoomSkipped?: boolean;
      };
      if (res.ok) {
        router.refresh();
        setNote(
          data.zoomSkipped
            ? {
                text: "Published — but NO Zoom meeting was created because Zoom isn't connected. Connect Zoom in Admin → Connections, then hit Publish again.",
                ok: false,
              }
            : { text: "Published.", ok: true },
        );
      } else {
        setNote({ text: data.error ?? "Publish failed", ok: false });
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="admin-actions-cell">
      <Link className="btn-mini" href={`/admin/sessions/${sessionId}/edit`}>
        Edit
      </Link>
      <button
        type="button"
        className="btn-mini"
        onClick={onPublish}
        disabled={publishing}
        title={
          hasMeeting
            ? "Re-publish (meeting already created)"
            : "Publish & create Zoom meeting"
        }
      >
        {publishing ? "Publishing…" : "Publish"}
      </button>
      {hasMeeting && (
        <button
          type="button"
          className="btn-mini"
          disabled={pending}
          title="Pull this session's Zoom cloud recording into the Library now (the hourly cron also does this automatically)"
          onClick={() =>
            startTransition(async () => {
              setNote(null);
              const res = await importSessionRecording(sessionId);
              setNote({ text: res.message ?? (res.ok ? "Imported." : "Import failed"), ok: res.ok });
              if (res.ok) router.refresh();
            })
          }
        >
          Get recording
        </button>
      )}
      <button
        type="button"
        className="btn-mini"
        onClick={onCancel}
        disabled={pending}
        title="Mark cancelled (keeps history; members see it as Cancelled)"
      >
        Cancel
      </button>
      <button
        type="button"
        className="btn-mini danger"
        onClick={onDelete}
        disabled={pending}
      >
        Delete
      </button>
      {note && (
        <span
          style={{
            fontSize: 11,
            fontWeight: note.ok ? 400 : 600,
            color: note.ok ? "var(--mid-gray)" : "#b3261e",
          }}
        >
          {note.text}
        </span>
      )}
    </div>
  );
}
