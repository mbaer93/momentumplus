"use client";

import { useState } from "react";
import { saveWhitneyPromptOverride } from "@/app/(portal)/admin/whitney/actions";

/*
 * Textarea editor for Whitney's system prompt. The stored override wins;
 * clearing the field (or "Reset") returns Whitney to the built-in frozen
 * version shipped in code.
 */
export function WhitneyPromptEditor({
  currentPrompt,
  defaultPrompt,
  isOverridden,
}: {
  currentPrompt: string;
  defaultPrompt: string;
  isOverridden: boolean;
}) {
  const [value, setValue] = useState(currentPrompt);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(prompt: string) {
    setSaving(true);
    setNote(null);
    const res = await saveWhitneyPromptOverride(prompt);
    setNote({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Couldn't save.") });
    setSaving(false);
  }

  return (
    <div className="whitney-admin-editor">
      <textarea
        className="whitney-admin-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={26}
        aria-label="Whitney system prompt"
        spellCheck={false}
      />
      <div className="whitney-admin-actions">
        <button
          type="button"
          className="whitney-admin-save"
          onClick={() => void save(value)}
          disabled={saving || value.trim().length === 0}
        >
          {saving ? "Saving…" : "Save instructions"}
        </button>
        {isOverridden && (
          <button
            type="button"
            className="whitney-admin-reset"
            onClick={() => {
              if (
                window.confirm(
                  "Discard the override and return Whitney to the built-in instructions?",
                )
              ) {
                setValue(defaultPrompt);
                void save("");
              }
            }}
            disabled={saving}
          >
            Reset to built-in version
          </button>
        )}
      </div>
      {note && (
        <p className={`whitney-admin-note ${note.ok ? "ok" : "err"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
