"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveSessionNote } from "@/app/(portal)/sessions/actions";

// Latest typed text per session, outliving any single editor instance — the
// editor mounts and unmounts as tabs/drawers open and close, and unmount
// used to silently discard whatever the debounce hadn't saved yet.
const memoryDrafts = new Map<string, string>();

// localStorage survives the full-page navigations the live room forces
// (ending a meeting reloads to ?left=1, which kills any in-flight save).
// Drafts older than this are ignored — a note edited on another device
// later must not be resurrected by a forgotten local copy.
const DRAFT_FRESH_MS = 12 * 60 * 60 * 1000;
const draftKey = (sessionId: string) => `mplus-note-draft:${sessionId}`;

function writeLocalDraft(sessionId: string, body: string) {
  try {
    localStorage.setItem(
      draftKey(sessionId),
      JSON.stringify({ body, at: Date.now() }),
    );
  } catch {
    /* storage full or blocked — server autosave still runs */
  }
}

function readLocalDraft(sessionId: string): string | null {
  try {
    const raw = localStorage.getItem(draftKey(sessionId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as { body?: string; at?: number };
    if (typeof draft.body !== "string" || typeof draft.at !== "number") {
      return null;
    }
    if (Date.now() - draft.at > DRAFT_FRESH_MS) return null;
    return draft.body;
  } catch {
    return null;
  }
}

export function NotesEditor({
  sessionId,
  initialNote,
}: {
  sessionId: string;
  initialNote: string;
}) {
  const [value, setValue] = useState(initialNote);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialNote);
  const valueRef = useRef(value);
  valueRef.current = value;

  const save = useCallback(
    async (body: string) => {
      if (body === lastSaved.current) return;
      setStatus("Saving…");
      const res = await saveSessionNote(sessionId, body);
      if (res.ok) {
        lastSaved.current = body;
        setStatus(res.preview ? "Saved (preview mode)" : "Saved");
      } else {
        setStatus(res.message ?? "Could not save");
      }
    },
    [sessionId],
  );

  // On mount, pick up anything a previous instance (closed drawer, switched
  // tab, forced reload after the meeting ended) didn't get to save. The
  // debounced autosave below then pushes it to the server.
  useEffect(() => {
    const draft = memoryDrafts.get(sessionId) ?? readLocalDraft(sessionId);
    if (draft !== null && draft !== undefined && draft !== initialNote) {
      setValue(draft);
      setStatus("Restored unsaved notes");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, save]);

  // Unmount flush: closing the notes drawer or leaving the page must never
  // eat the last few seconds of typing.
  useEffect(
    () => () => {
      if (valueRef.current !== lastSaved.current) {
        void save(valueRef.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div>
      <textarea
        className="notes-area"
        placeholder="Your private notes for this session. Only you can see these."
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus("");
          // Mirror every keystroke so even a hard page kill loses nothing.
          memoryDrafts.set(sessionId, e.target.value);
          writeLocalDraft(sessionId, e.target.value);
        }}
        onBlur={() => void save(value)}
      />
      <div className="notes-status">{status}</div>
    </div>
  );
}
