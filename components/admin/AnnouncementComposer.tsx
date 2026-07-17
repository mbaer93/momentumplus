"use client";

import { useState, useTransition } from "react";
import type { Tier } from "@/lib/types";
import { tierLabel } from "@/lib/access";
import {
  previewAnnouncementAudience,
  sendAnnouncement,
} from "@/app/(portal)/admin/announcements/actions";

// Current member levels first; legacy tiers stay selectable because members
// granted under the old system still hold them. Labels come from the same
// registry as everywhere else (lib/access), so this list can't drift again.
const CURRENT_TIERS: Tier[] = ["basic", "pro", "vip", "gift", "speaker"];
const LEGACY_TIERS: Tier[] = [
  "sub_monthly",
  "sub_3mo",
  "sub_6mo",
  "sub_annual",
  "tsls_attendee",
  "tsls_vip",
];
const TIER_OPTIONS: { value: Tier; label: string; legacy?: boolean }[] = [
  ...CURRENT_TIERS.map((value) => ({ value, label: tierLabel(value) })),
  ...LEGACY_TIERS.map((value) => ({
    value,
    label: `${tierLabel(value)} (legacy)`,
    legacy: true,
  })),
];

export function AnnouncementComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tiers, setTiers] = useState<Tier[]>(TIER_OPTIONS.map((t) => t.value));
  const [channels, setChannels] = useState<("email" | "in_app")[]>([
    "email",
    "in_app",
  ]);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Two-step send: first click counts the audience, second click sends.
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // Set when a send partially failed — resending skips everyone reached.
  const [resumeId, setResumeId] = useState<string | undefined>(undefined);

  function toggleTier(t: Tier) {
    setTiers((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }
  function toggleChannel(c: "email" | "in_app") {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // Step 1: count the audience and ask for confirmation — a single
    // mis-click must never email every member.
    if (confirmCount === null) {
      startTransition(async () => {
        const { count } = await previewAnnouncementAudience(tiers);
        setConfirmCount(count);
      });
      return;
    }

    startTransition(async () => {
      const res = await sendAnnouncement(
        { title, body, audienceTiers: tiers, channels },
        resumeId,
      );
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Sent." : "Error") });
      if (res.ok) {
        setConfirmCount(null);
        setResumeId(undefined);
        if (!res.preview) {
          setTitle("");
          setBody("");
        }
      } else {
        // Keep the confirm armed and remember the announcement so a retry
        // resumes it instead of double-sending.
        setResumeId(res.announcementId ?? resumeId);
      }
    });
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <div className="admin-field">
        <label htmlFor="ann-title">Title</label>
        <input
          id="ann-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. March session schedule is live"
        />
      </div>
      <div className="admin-field">
        <label htmlFor="ann-body">Message</label>
        <textarea
          id="ann-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What members need to know…"
        />
      </div>

      <div className="admin-field">
        <label>Audience tiers</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {TIER_OPTIONS.map((t) => (
            <button
              type="button"
              key={t.value}
              className={`tier-chip${tiers.includes(t.value) ? " selected" : ""}`}
              onClick={() => toggleTier(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-field">
        <label>Channels</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`tier-chip${channels.includes("email") ? " selected" : ""}`}
            onClick={() => toggleChannel("email")}
          >
            Email (via GHL)
          </button>
          <button
            type="button"
            className={`tier-chip${channels.includes("in_app") ? " selected" : ""}`}
            onClick={() => toggleChannel("in_app")}
          >
            In-app
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 8 }}>
          SMS announcements are intentionally excluded — SMS stays strictly
          opt-in per member and per notification type.
        </div>
      </div>

      <div className="admin-form-actions" style={{ flexWrap: "wrap" }}>
        <button
          type="submit"
          className="btn-purple"
          disabled={pending || tiers.length === 0 || channels.length === 0}
        >
          {pending
            ? confirmCount === null
              ? "Counting audience…"
              : "Sending…"
            : confirmCount === null
              ? "Review & send"
              : resumeId
                ? `Retry failed sends (${confirmCount} members)`
                : `Confirm — send to ${confirmCount} member${confirmCount === 1 ? "" : "s"}`}
        </button>
        {confirmCount !== null && !pending && (
          <button
            type="button"
            className="btn-mini"
            onClick={() => {
              setConfirmCount(null);
              setResumeId(undefined);
              setMsg(null);
            }}
          >
            Cancel
          </button>
        )}
        {confirmCount !== null && !pending && !msg && (
          <span style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
            This reaches {confirmCount} member{confirmCount === 1 ? "" : "s"} via{" "}
            {channels.map((c) => (c === "email" ? "email" : "in-app")).join(" + ")}.
            Nothing has been sent yet.
          </span>
        )}
        {msg && (
          <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
