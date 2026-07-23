"use client";

import { useState, useTransition } from "react";
import type { Tier } from "@/lib/types";
import { tierLabel } from "@/lib/access";
import {
  previewAnnouncementAudience,
  sendAnnouncement,
} from "@/app/(portal)/admin/announcements/actions";

// The current member levels only, labeled from the same registry as
// everywhere else (lib/access) so this list can't drift again.
const TIER_OPTIONS: { value: Tier; label: string }[] = (
  ["basic", "pro", "vip", "gift", "sponsor", "speaker"] as Tier[]
).map((value) => ({ value, label: tierLabel(value) }));

export function AnnouncementComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Nothing pre-selected — the admin chooses the audience and channels
  // deliberately every time.
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [channels, setChannels] = useState<
    ("email" | "in_app" | "community" | "sms")[]
  >([]);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Two-step send: first click counts the audience, second click sends.
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // SMS reaches only the opted-in-with-phone subset — counted separately so
  // the admin sees exactly how many texts Confirm will send.
  const [confirmSmsCount, setConfirmSmsCount] = useState(0);
  // Set when a send partially failed — resending skips everyone reached.
  const [resumeId, setResumeId] = useState<string | undefined>(undefined);

  // Any edit after "Review & send" disarms the confirm — the count shown
  // must always describe exactly what the Confirm click will send. It also
  // drops the resume handle: edited content is a new announcement, not a
  // retry of the old one.
  function disarm() {
    setConfirmCount(null);
    setResumeId(undefined);
    setMsg(null);
  }
  function toggleTier(t: Tier) {
    disarm();
    setTiers((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }
  function toggleChannel(c: "email" | "in_app" | "community" | "sms") {
    disarm();
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
        const { count, smsCount } = await previewAnnouncementAudience(tiers);
        setConfirmCount(count);
        setConfirmSmsCount(smsCount);
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
          onChange={(e) => {
            disarm();
            setTitle(e.target.value);
          }}
          placeholder="e.g. March session schedule is live"
        />
      </div>
      <div className="admin-field">
        <label htmlFor="ann-body">Message</label>
        <textarea
          id="ann-body"
          value={body}
          onChange={(e) => {
            disarm();
            setBody(e.target.value);
          }}
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
          <button
            type="button"
            className={`tier-chip${channels.includes("community") ? " selected" : ""}`}
            onClick={() => toggleChannel("community")}
          >
            Community (#announcements)
          </button>
          <button
            type="button"
            className={`tier-chip${channels.includes("sms") ? " selected" : ""}`}
            onClick={() => toggleChannel("sms")}
          >
            Text (SMS, opted-in only)
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 8 }}>
          Community posts land in the #announcements channel (visible to all
          members regardless of tier). Texts go ONLY to members who turned on
          &ldquo;Announcement texts&rdquo; in their notification preferences
          and have a phone number — the confirm step shows exactly how many
          that is. In-app announcements also push to members&rsquo; devices
          where they&rsquo;ve enabled push notifications.
        </div>
      </div>

      <div className="admin-form-actions" style={{ flexWrap: "wrap" }}>
        <button
          type="submit"
          className="btn-purple"
          disabled={
            pending ||
            channels.length === 0 ||
            (tiers.length === 0 && !channels.includes("community"))
          }
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
            {channels
              .map((c) =>
                c === "email"
                  ? "email"
                  : c === "sms"
                    ? `text (${confirmSmsCount} opted in)`
                    : c === "community"
                      ? "community"
                      : "in-app",
              )
              .join(" + ")}
            . Nothing has been sent yet.
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
