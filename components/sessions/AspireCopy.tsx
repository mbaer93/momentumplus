"use client";

import { useState } from "react";
import { saveAspireCopy } from "@/app/(portal)/aspire2achieve/actions";

/* The A2A "About the program" card. Members see the paragraphs; admins get
   an Edit button that swaps in a textarea and saves in place (blank line =
   new paragraph). */
export function AspireCopy({
  text,
  isAdmin,
}: {
  text: string;
  isAdmin: boolean;
}) {
  const [current, setCurrent] = useState(text);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  return (
    <div
      className="admin-form"
      style={{ maxWidth: "none", marginBottom: 18, padding: "16px 18px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--gold)",
            fontWeight: 600,
          }}
        >
          About the program
        </div>
        {isAdmin && !editing && (
          <button
            type="button"
            className="btn-mini"
            onClick={() => {
              setDraft(current);
              setStatus(null);
              setEditing(true);
            }}
          >
            Edit description
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={9}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 13.5,
              lineHeight: 1.6,
              background: "var(--cream)",
              resize: "vertical",
            }}
            aria-label="A2A page description"
          />
          <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", margin: "6px 0 10px" }}>
            A blank line starts a new paragraph. Members see this exactly as
            written.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || !draft.trim()}
              onClick={async () => {
                setSaving(true);
                const res = await saveAspireCopy(draft);
                setSaving(false);
                setStatus({
                  ok: res.ok,
                  text: res.message ?? (res.ok ? "Saved" : "Couldn't save"),
                });
                if (res.ok) {
                  setCurrent(draft.trim());
                  setEditing(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save description"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        current
          .split(/\n\s*\n/)
          .filter((p) => p.trim())
          .map((para, i) => (
            <p
              key={i}
              style={{
                fontSize: 13.5,
                lineHeight: 1.65,
                margin: i === 0 ? 0 : "10px 0 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {para.trim()}
            </p>
          ))
      )}
      {status && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12.5,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
