"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveSessionNote } from "@/app/(portal)/sessions/actions";

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

  // Debounced autosave.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, save]);

  return (
    <div>
      <textarea
        className="notes-area"
        placeholder="Your private notes for this session. Only you can see these."
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus("");
        }}
        onBlur={() => void save(value)}
      />
      <div className="notes-status">{status}</div>
    </div>
  );
}
