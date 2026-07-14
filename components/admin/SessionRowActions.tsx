"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteSession } from "@/app/(portal)/admin/sessions/actions";

export function SessionRowActions({
  sessionId,
  hasMeeting,
}: {
  sessionId: string;
  hasMeeting: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

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
    setNote(null);
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
        title={
          hasMeeting
            ? "Re-publish (meeting already created)"
            : "Publish & create Zoom meeting"
        }
      >
        Publish
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
