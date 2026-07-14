"use client";

import { useState, useTransition } from "react";
import type { Tier } from "@/lib/types";
import { sendAnnouncement } from "@/app/(portal)/admin/announcements/actions";

const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "sub_monthly", label: "Monthly" },
  { value: "sub_3mo", label: "3-Month" },
  { value: "sub_6mo", label: "6-Month" },
  { value: "sub_annual", label: "12-Month" },
  { value: "tsls_attendee", label: "TSLS Attendees" },
  { value: "tsls_vip", label: "TSLS VIP" },
  { value: "speaker", label: "Speakers" },
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
    startTransition(async () => {
      const res = await sendAnnouncement({
        title,
        body,
        audienceTiers: tiers,
        channels,
      });
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Sent." : "Error") });
      if (res.ok && !res.preview) {
        setTitle("");
        setBody("");
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

      <div className="admin-form-actions">
        <button
          type="submit"
          className="btn-purple"
          disabled={pending || tiers.length === 0 || channels.length === 0}
        >
          {pending ? "Sending…" : "Send announcement"}
        </button>
        {msg && (
          <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
