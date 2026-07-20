"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createScheduledPost,
  deleteScheduledPost,
  updateScheduledPost,
} from "@/app/(portal)/admin/announcements/actions";

export interface ScheduledPostRow {
  id: string;
  channel: string;
  body: string;
  /** ISO */
  sendAt: string;
  sentAt: string | null;
}

/** Channels admins can schedule into (mirrors lib/stream COMMUNITY_CHANNELS). */
const CHANNELS = [
  "announcements",
  "general",
  "networking",
  "speaker-qa",
  "resources",
  "vip-only",
  "annual-members",
];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Scheduled community posts: compose ahead of time, edit or cancel any time
 * before it goes out; the cron posts it to chat as "Momentum+ Team".
 */
export function ScheduledPostsManager({ rows }: { rows: ScheduledPostRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [draft, setDraft] = useState({
    channel: "announcements",
    body: "",
    sendAt: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ channel: "", body: "", sendAt: "" });

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — refresh this page and try again (the app may have just been updated).", ok: false });
      }
    });
  }

  const upcomingRows = rows.filter((r) => !r.sentAt);
  const sentRows = rows.filter((r) => r.sentAt).slice(0, 8);

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginTop: 20 }}>
      <div className="admin-field" style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 13 }}>Scheduled community posts</label>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
        Write it now, post it later: at the chosen time the message appears in
        the selected Community channel from &ldquo;Momentum+ Team&rdquo;.
        Editable until it goes out.
      </div>

      {/* Compose */}
      <div className="admin-field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="admin-field">
          <label htmlFor="sp-channel">Channel</label>
          <select
            id="sp-channel"
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                #{c}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor="sp-when">Post at</label>
          <input
            id="sp-when"
            type="datetime-local"
            value={draft.sendAt}
            onChange={(e) => setDraft({ ...draft, sendAt: e.target.value })}
          />
        </div>
      </div>
      <div className="admin-field">
        <label htmlFor="sp-body">Message</label>
        <textarea
          id="sp-body"
          rows={3}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder="What should the community hear, and when?"
        />
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !draft.body.trim() || !draft.sendAt}
          onClick={() =>
            run(async () => {
              const res = await createScheduledPost({
                channel: draft.channel,
                body: draft.body,
                sendAt: new Date(draft.sendAt).toISOString(),
              });
              if (res.ok) setDraft({ channel: draft.channel, body: "", sendAt: "" });
              return res;
            })
          }
        >
          Schedule post
        </button>
        {msg && (
          <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
            {msg.text}
          </span>
        )}
      </div>

      {/* Pending list */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          Waiting to post ({upcomingRows.length})
        </div>
        {upcomingRows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
            Nothing scheduled.
          </div>
        ) : (
          upcomingRows.map((r) =>
            editingId === r.id ? (
              <div
                key={r.id}
                style={{
                  border: "1px solid var(--warm-gray)",
                  borderRadius: 4,
                  padding: 12,
                  marginBottom: 8,
                  background: "#fbfaf8",
                }}
              >
                <div className="admin-field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div className="admin-field">
                    <label>Channel</label>
                    <select
                      value={edit.channel}
                      onChange={(e) => setEdit({ ...edit, channel: e.target.value })}
                    >
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          #{c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-field">
                    <label>Post at</label>
                    <input
                      type="datetime-local"
                      value={edit.sendAt}
                      onChange={(e) => setEdit({ ...edit, sendAt: e.target.value })}
                    />
                  </div>
                </div>
                <div className="admin-field">
                  <label>Message</label>
                  <textarea
                    rows={3}
                    value={edit.body}
                    onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                  />
                </div>
                <div className="admin-form-actions" style={{ marginTop: 0 }}>
                  <button
                    type="button"
                    className="btn-mini"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await updateScheduledPost(r.id, {
                          channel: edit.channel,
                          body: edit.body,
                          sendAt: new Date(edit.sendAt).toISOString(),
                        });
                        if (res.ok) setEditingId(null);
                        return res;
                      })
                    }
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid var(--warm-gray)",
                  borderRadius: 4,
                  padding: "10px 12px",
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700 }}>
                    #{r.channel} · {whenLabel(r.sendAt)}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 2, whiteSpace: "pre-wrap" }}>
                    {r.body}
                  </div>
                </div>
                <div className="admin-actions-cell">
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={() => {
                      setEditingId(r.id);
                      setEdit({
                        channel: r.channel,
                        body: r.body,
                        sendAt: toLocalInput(r.sendAt),
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-mini danger"
                    disabled={pending}
                    onClick={() => {
                      if (confirm("Delete this scheduled post?")) {
                        run(() => deleteScheduledPost(r.id));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ),
          )
        )}
      </div>

      {/* Recently sent */}
      {sentRows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            Recently posted
          </div>
          {sentRows.map((r) => (
            <div
              key={r.id}
              style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 4 }}
            >
              #{r.channel} · {whenLabel(r.sentAt ?? r.sendAt)} — {r.body.slice(0, 80)}
              {r.body.length > 80 ? "…" : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
