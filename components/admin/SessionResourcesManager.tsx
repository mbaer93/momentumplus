"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addSessionResourceAction,
  deleteSessionResourceAction,
  moveSessionResourceAction,
} from "@/app/(portal)/admin/sessions/actions";
import type { SessionResource } from "@/lib/types";

/*
 * Admin manager for a session's resources (session editor page). Add by
 * link or file upload, reorder, remove — what members see in the session
 * page's Resources tab and the live room's drawer.
 */
export function SessionResourcesManager({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: SessionResource[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    if (res.message) setMsg({ ok: res.ok, text: res.message });
    setBusy(false);
    router.refresh();
    return res;
  }

  return (
    <div className="admin-card" style={{ marginTop: 24 }}>
      <div className="admin-field" style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 13 }}>Session resources</label>
        <p style={{ fontSize: 12.5, color: "var(--mid-gray)", margin: "4px 0 0" }}>
          Shown to members on the session page and inside the live room
          (Resources tab). Add a link, or upload a PDF, document, slides,
          image, or MP4.
        </p>
      </div>

      {initial.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--mid-gray)", padding: "8px 0" }}>
          No resources yet.
        </div>
      )}
      {initial.map((r, i) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderTop: "1px solid var(--warm-gray)",
            padding: "8px 0",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</div>
            <div style={{ fontSize: 12, color: "var(--mid-gray)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.type} · {r.url}
            </div>
          </div>
          <button
            type="button"
            className="btn-mini"
            disabled={busy || i === 0}
            onClick={() => void run(() => moveSessionResourceAction(r.id, "up"))}
            aria-label={`Move ${r.name} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn-mini"
            disabled={busy || i === initial.length - 1}
            onClick={() => void run(() => moveSessionResourceAction(r.id, "down"))}
            aria-label={`Move ${r.name} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn-mini"
            disabled={busy}
            onClick={() => {
              if (confirm(`Remove "${r.name}" from this session?`)) {
                void run(() => deleteSessionResourceAction(r.id));
              }
            }}
          >
            Remove
          </button>
        </div>
      ))}

      <div style={{ borderTop: "1px solid var(--warm-gray)", paddingTop: 12, marginTop: 4 }}>
        <div className="admin-field">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Session workbook"
            disabled={busy}
          />
        </div>
        <div className="admin-field">
          <label>Link (or attach a file below instead)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={busy}
          />
        </div>
        <div className="admin-field">
          <label>File</label>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.mp4,.docx,.pptx,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !name.trim() || (!url.trim() && !file)}
          onClick={() => {
            const fd = new FormData();
            fd.set("name", name);
            fd.set("url", url);
            if (file) fd.set("file", file);
            void run(() => addSessionResourceAction(sessionId, fd)).then(
              (res) => {
                if (res.ok) {
                  setName("");
                  setUrl("");
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }
              },
            );
          }}
        >
          {busy ? "Saving…" : "Add resource"}
        </button>
        {msg && (
          <p
            style={{
              marginTop: 8,
              fontSize: 12.5,
              color: msg.ok ? "#4a7c59" : "#b3564a",
            }}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
