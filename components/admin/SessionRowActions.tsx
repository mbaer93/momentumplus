"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cancelSession,
  deleteSession,
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
  const [note, setNote] = useState<string | null>(null);

  function onCancel() {
    if (
      !confirm(
        "Cancel this session? Members will see it marked Cancelled and enrollment closes. They are NOT notified automatically — send an announcement if they should hear about it.",
      )
    )
      return;
    startTransition(async () => {
      const res = await cancelSession(sessionId);
      setNote(res.message ?? null);
      if (res.ok) router.refresh();
    });
  }

  function onDelete() {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    startTransition(async () => {
      const res = await deleteSession(sessionId);
      setNote(res.preview ? res.message ?? null : null);
      if (res.ok) router.refresh();
      else setNote(res.message ?? "Delete failed");
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        router.refresh();
        setNote("Published.");
      } else {
        setNote(data.error ?? "Publish failed");
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
        <span style={{ fontSize: 11, color: "var(--mid-gray)" }}>{note}</span>
      )}
    </div>
  );
}
