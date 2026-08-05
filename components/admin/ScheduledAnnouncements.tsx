"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelScheduledAnnouncement } from "@/app/(portal)/admin/announcements/actions";

export interface ScheduledAnnouncementRow {
  id: string;
  title: string;
  /** Preformatted local send time. */
  whenLabel: string;
  audience: string;
  channels: string;
}

/* Announcements waiting to go out (composed with Schedule). Cancellable
   until the cron delivers them; editing = cancel and recompose. */
export function ScheduledAnnouncements({
  rows,
}: {
  rows: ScheduledAnnouncementRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="card">
      <div className="card-header">
        <h3>Scheduled</h3>
      </div>
      <div style={{ padding: 16 }}>
        {rows.length === 0 ? (
          <div className="sess-empty-note">
            Nothing scheduled — pick &ldquo;Schedule&rdquo; in the composer to
            queue an announcement.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="profile-kv"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div>
                <div className="k">
                  {r.whenLabel}
                  {r.audience ? ` · ${r.audience}` : ""} · {r.channels}
                </div>
                <strong>{r.title}</strong>
              </div>
              <button
                type="button"
                className="btn-mini danger"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Cancel this scheduled announcement?")) return;
                  startTransition(async () => {
                    const res = await cancelScheduledAnnouncement(r.id);
                    setMsg({
                      ok: res.ok,
                      text: res.message ?? (res.ok ? "Cancelled." : "Error"),
                    });
                    if (res.ok) router.refresh();
                  });
                }}
              >
                Cancel
              </button>
            </div>
          ))
        )}
        {msg && (
          <div
            className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
            style={{ marginTop: 8 }}
          >
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
