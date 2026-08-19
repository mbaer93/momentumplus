"use client";

import { useState, useTransition } from "react";
import type { Tier } from "@/lib/types";
import { tierLabel } from "@/lib/access";
import { selectableBadges } from "@/lib/badges";
import {
  badgeSegments,
  previewAnnouncementAudience,
  runBadgeSync,
  scheduleAnnouncement,
  sendAnnouncement,
  type BadgeSegment,
} from "@/app/(portal)/admin/announcements/actions";

// The current member levels only, labeled from the same registry as
// everywhere else (lib/access) so this list can't drift again.
const TIER_OPTIONS: { value: Tier; label: string }[] = (
  ["basic", "pro", "vip", "gift", "sponsor", "speaker"] as Tier[]
).map((value) => ({ value, label: tierLabel(value) }));

/*
 * Badge targeting (Matt, 2026-08-19): "I want to also be able to select
 * badge tiers when sending messages inside the system through the
 * announcements portal." Grouped exactly as lib/badges.ts orders them, and
 * unioned with the tiers rather than intersected — "everyone on annual OR
 * anyone who is a Founding Member" is the shape an offer actually takes.
 */
const BADGE_GROUPS: { group: string; items: { key: string; label: string }[] }[] =
  selectableBadges().reduce(
    (acc, b) => {
      const found = acc.find((g) => g.group === b.group);
      if (found) found.items.push({ key: b.key, label: b.label });
      else acc.push({ group: b.group, items: [{ key: b.key, label: b.label }] });
      return acc;
    },
    [] as { group: string; items: { key: string; label: string }[] }[],
  );

export function AnnouncementComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Nothing pre-selected — the admin chooses the audience and channels
  // deliberately every time.
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [badges, setBadges] = useState<string[]>([]);
  const [showBadges, setShowBadges] = useState(false);
  // Holder counts, loaded only when the picker is opened — a badge with two
  // holders is a different decision from one with two hundred, and picking
  // blind is how an "offer" reaches nobody.
  const [segments, setSegments] = useState<BadgeSegment[] | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
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
  // Send now, or schedule for later (Matt, 2026-08-05): one composer, both
  // timings. Scheduling records the announcement; the cron delivers it
  // through the exact same channels when the time comes.
  const [timing, setTiming] = useState<"now" | "schedule">("now");
  const [sendAt, setSendAt] = useState("");

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
  function openBadges() {
    const next = !showBadges;
    setShowBadges(next);
    if (next && segments === null) {
      startTransition(async () => {
        setSegments(await badgeSegments());
      });
    }
  }
  function toggleBadge(key: string) {
    disarm();
    setBadges((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
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
        const { count, smsCount } = await previewAnnouncementAudience(
          tiers,
          badges,
        );
        setConfirmCount(count);
        setConfirmSmsCount(smsCount);
      });
      return;
    }

    startTransition(async () => {
      const res =
        timing === "schedule"
          ? await scheduleAnnouncement(
              { title, body, audienceTiers: tiers, audienceBadges: badges, channels },
              new Date(sendAt).toISOString(),
            )
          : await sendAnnouncement(
              { title, body, audienceTiers: tiers, audienceBadges: badges, channels },
              resumeId,
            );
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Sent." : "Error") });
      if (res.ok) {
        setConfirmCount(null);
        setResumeId(undefined);
        if (!res.preview) {
          setTitle("");
          setBody("");
          setSendAt("");
          setTiming("now");
        }
      } else if (timing === "now") {
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
        <label>Audience badges (optional)</label>
        <p
          style={{
            fontSize: 12,
            color: "var(--ink-secondary)",
            margin: "0 0 8px",
          }}
        >
          Anyone holding a selected badge is added to the audience, on top of
          the tiers above — not narrowed down to it. Members still need active
          access to be messaged, and badges are written down nightly, so
          someone who earned one today joins tomorrow.
        </p>
        {badges.length > 0 && (
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            {badges.length} badge{badges.length === 1 ? "" : "s"} selected
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-mini" onClick={openBadges}>
            {showBadges ? "Hide badges" : "Choose badges"}
          </button>
          {showBadges && (
            <button
              type="button"
              className="btn-mini"
              disabled={pending}
              title="Re-check everyone's badges now and push any new ones to GHL as contact tags. Otherwise this happens overnight."
              onClick={() => {
                setSyncMsg(null);
                startTransition(async () => {
                  const res = await runBadgeSync();
                  setSyncMsg(res.message);
                  setSegments(await badgeSegments());
                });
              }}
            >
              {pending ? "Syncing…" : "Sync badges now"}
            </button>
          )}
        </div>
        {syncMsg && (
          <div style={{ fontSize: 12, marginTop: 8 }}>{syncMsg}</div>
        )}
        {showBadges && (
          <div style={{ marginTop: 10 }}>
            {BADGE_GROUPS.map((g) => (
              <div key={g.group} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--ink-secondary)",
                    marginBottom: 6,
                  }}
                >
                  {g.group}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {g.items.map((b) => {
                    const holders = segments?.find(
                      (s) => s.key === b.key,
                    )?.holders;
                    return (
                      <button
                        type="button"
                        key={b.key}
                        className={`tier-chip${badges.includes(b.key) ? " selected" : ""}`}
                        onClick={() => toggleBadge(b.key)}
                      >
                        {b.label}
                        {holders !== undefined && (
                          <span style={{ opacity: 0.7 }}> · {holders}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-field">
        <label>Channels</label>
        {/* flexWrap: four chips overflow a 360px phone and the SMS chip
            became unreachable (clipped by the content area). */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 8 }}>
          Community posts land in the #announcements channel (visible to all
          members regardless of tier). Texts go ONLY to members who turned on
          &ldquo;Announcement texts&rdquo; in their notification preferences
          and have a phone number — the confirm step shows exactly how many
          that is. In-app announcements also push to members&rsquo; devices
          where they&rsquo;ve enabled push notifications.
        </div>
      </div>

      <div className="admin-field">
        <label>When</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className={`tier-chip${timing === "now" ? " selected" : ""}`}
            onClick={() => {
              disarm();
              setTiming("now");
            }}
          >
            Send now
          </button>
          <button
            type="button"
            className={`tier-chip${timing === "schedule" ? " selected" : ""}`}
            onClick={() => {
              disarm();
              setTiming("schedule");
            }}
          >
            Schedule
          </button>
          {timing === "schedule" && (
            <input
              type="datetime-local"
              aria-label="Send at"
              value={sendAt}
              onChange={(e) => {
                disarm();
                setSendAt(e.target.value);
              }}
              style={{ maxWidth: 230 }}
            />
          )}
        </div>
        {timing === "schedule" && (
          <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 6 }}>
            Sends automatically within a few minutes of the chosen time,
            through the same channels selected above. Scheduled announcements
            appear below and can be cancelled until they go out.
          </div>
        )}
      </div>

      <div className="admin-form-actions" style={{ flexWrap: "wrap" }}>
        <button
          type="submit"
          className="btn-purple"
          disabled={
            pending ||
            channels.length === 0 ||
            (tiers.length === 0 &&
              badges.length === 0 &&
              !channels.includes("community")) ||
            (timing === "schedule" && !sendAt)
          }
        >
          {pending
            ? confirmCount === null
              ? "Counting audience…"
              : timing === "schedule"
                ? "Scheduling…"
                : "Sending…"
            : confirmCount === null
              ? timing === "schedule"
                ? "Review & schedule"
                : "Review & send"
              : resumeId
                ? `Retry failed sends (${confirmCount} members)`
                : timing === "schedule"
                  ? `Confirm — schedule for ${confirmCount} member${confirmCount === 1 ? "" : "s"}`
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
          <span style={{ fontSize: 12.5, color: "var(--ink-secondary)" }}>
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
