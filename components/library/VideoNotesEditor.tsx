"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveVideoNote } from "@/app/(portal)/library/actions";

/** Debounced-autosave private notes on a Library video (owner-only). */
export function VideoNotesEditor({
  videoId,
  initialNote,
}: {
  videoId: string;
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
      const res = await saveVideoNote(videoId, body);
      if (res.ok) {
        lastSaved.current = body;
        setStatus(res.preview ? "Saved (preview mode)" : "Saved");
      } else {
        setStatus(res.message ?? "Could not save");
      }
    },
    [videoId],
  );

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
        placeholder="Your private notes on this recording. Only you can see these."
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
