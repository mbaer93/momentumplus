"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// Session times are entered and displayed as Eastern Time — the same wall
// time the server stores, so a no-op save can never shift the schedule.
import { isoToEasternInput } from "@/lib/eastern-time";
import { isDropInProgram } from "@/lib/programs";
import type { AccessLevel, SessionStatus } from "@/lib/types";
import {
  createSession,
  updateSession,
  type SessionFormValues,
} from "@/app/(portal)/admin/sessions/actions";

// Current taxonomy (Sierra, 2026-07-22). Older sessions may carry legacy
// values (Leadership/Wellness/Business/Networking) until re-saved.
const CATEGORIES = [
  "Monthly Educational Session",
  "Accountability Session",
  "Productivity Session",
  "AI Leadership Lab",
  "Bonus Sessions",
];
const ACCESS: { value: AccessLevel; label: string }[] = [
  { value: "all_members", label: "All members" },
  { value: "vip_plus", label: "Exclusive — Pro, speakers & sponsors" },
  { value: "pro_only", label: "Pro members only (exclusive)" },
  { value: "admin_only", label: "Admin only" },
];
const STATUSES: SessionStatus[] = [
  "draft",
  "scheduled",
  "live",
  "completed",
  // Cancelled keeps the session visible to members with an honest
  // "Cancelled" state; archived hides it entirely.
  "cancelled",
  "archived",
];

export function SessionForm({
  mode,
  sessionId,
  initial,
  speakers = [],
  adminHosts = [],
}: {
  mode: "create" | "edit";
  sessionId?: string;
  initial?: Partial<SessionFormValues> & { startsAtIso?: string | null };
  /** Speakers already in the system — the session links to one of them. */
  speakers?: { id: string; name: string }[];
  /** Active admin names — drop-in programs are hosted by the SLC team, so
      their host picker lists admins instead of speakers. */
  adminHosts?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [values, setValues] = useState<SessionFormValues>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    category: initial?.category ?? "Monthly Educational Session",
    startsAt: isoToEasternInput(initial?.startsAtIso ?? null),
    durationMin: initial?.durationMin ?? 60,
    capacity: initial?.capacity ?? null,
    minAccess: initial?.minAccess ?? "all_members",
    status: initial?.status ?? "draft",
    speakerId: initial?.speakerId ?? "",
    program: initial?.program ?? "standard",
    recurrence: initial?.recurrence ?? "",
    recurrenceUntil: initial?.recurrenceUntil ?? "",
    hostName: initial?.hostName ?? "",
  });

  function set<K extends keyof SessionFormValues>(
    key: K,
    value: SessionFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createSession(values)
          : await updateSession(sessionId!, values);
      // A warning (e.g. Zoom couldn't be rescheduled) must be SEEN — style
      // it as an error and stay on the form instead of navigating away.
      setMsg({
        ok: res.ok && !res.warning,
        text: res.message ?? (res.ok ? "Saved." : "Error"),
      });
      if (res.ok && !res.preview && !res.warning) {
        router.push("/admin/sessions");
        router.refresh();
      }
    });
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <div className="admin-field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          required
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Resilience Rituals for High-Achievers"
        />
      </div>

      <div className="admin-field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this session covers…"
        />
      </div>

      <div className="admin-field">
        <label htmlFor="program">Program</label>
        <select
          id="program"
          value={values.program}
          onChange={(e) => {
            const program = e.target.value as SessionFormValues["program"];
            setValues((v) => ({
              ...v,
              program,
              // Drop-ins are admin-hosted — a linked speaker would show the
              // session on that speaker's profile, which is wrong here.
              ...(isDropInProgram(program) ? { speakerId: "" } : {}),
              // Rooted Focus defaults: 90 minutes, weekly, Productivity.
              ...(program === "rooted_focus" && v.program !== "rooted_focus"
                ? {
                    durationMin: 90,
                    recurrence: "weekly" as const,
                    category: "Productivity Session",
                  }
                : {}),
              // Aspire2Achieve defaults: 45-minute monthly accountability.
              ...(program === "aspire" && v.program !== "aspire"
                ? {
                    durationMin: 45,
                    recurrence: "monthly" as const,
                    category: "Accountability Session",
                  }
                : {}),
            }));
          }}
        >
          <option value="standard">Main Session (Sessions tab)</option>
          <option value="addon">Add-on Session (Sessions tab)</option>
          <option value="rooted_focus">Rooted Focus (own tab)</option>
          <option value="aspire">Aspire2Achieve Growth (own tab)</option>
        </select>
        {values.program === "addon" && (
          <div style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 4 }}>
            Add-on Sessions are speaker-led extras (e.g. a monthly AI-in-
            business series). They appear on the Sessions tab and calendar
            with an Add-on badge, members enroll normally, and they can be
            one-time or recurring via the Repeats field.
          </div>
        )}
        {values.program === "rooted_focus" && (
          <div style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 4 }}>
            Rooted Focus sessions show on the Rooted Focus tab and the
            calendar — never in the library, and no resources or AI summary.
            Enrolling adds the whole recurring series to a member&apos;s
            calendar.
          </div>
        )}
      </div>

      {isDropInProgram(values.program) ? (
        /* Drop-ins (Rooted Focus / Aspire2Achieve) are always led by the SLC
           team — the host picker lists admins, not speakers. The name lands
           in host_name; no speaker is ever linked. */
        <div className="admin-field">
          <label htmlFor="hostName">Host (admin)</label>
          <select
            id="hostName"
            value={values.hostName}
            onChange={(e) => set("hostName", e.target.value)}
          >
            <option value="">— Choose a host —</option>
            {/* An existing host who is no longer an active admin stays
                selectable — otherwise the select silently rewrites it. */}
            {(values.hostName && !adminHosts.includes(values.hostName)
              ? [values.hostName, ...adminHosts]
              : adminHosts
            ).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 4 }}>
            Drop-in sessions are hosted by the SLC team. Any admin can start
            the Zoom meeting as host from the session page.
          </div>
        </div>
      ) : (
        <>
          <div className="admin-field">
            <label htmlFor="speaker">Speaker</label>
            <select
              id="speaker"
              value={values.speakerId}
              onChange={(e) => set("speakerId", e.target.value)}
            >
              <option value="">— No speaker yet —</option>
              {speakers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 4 }}>
              Speakers are managed in Admin → Speakers; linking one shows the
              session on their profile.
            </div>
          </div>

          <div className="admin-field">
            <label htmlFor="hostName">
              Host name (if the leader isn&apos;t a speaker — e.g. an SLC team
              member)
            </label>
            <input
              id="hostName"
              value={values.hostName}
              onChange={(e) => set("hostName", e.target.value)}
              placeholder="e.g. Sierra Collins"
            />
            <div style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 4 }}>
              Shown as the session leader when no speaker is linked. Admins can
              always start the Zoom meeting as host from the session page.
            </div>
          </div>
        </>
      )}

      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor="recurrence">Repeats</label>
          <select
            id="recurrence"
            value={values.recurrence}
            onChange={(e) =>
              set(
                "recurrence",
                e.target.value as SessionFormValues["recurrence"],
              )
            }
          >
            <option value="">One-time (no repeat)</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every other week</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor="recurrenceUntil">Repeats until (optional)</label>
          <input
            id="recurrenceUntil"
            type="date"
            value={values.recurrenceUntil}
            onChange={(e) => set("recurrenceUntil", e.target.value)}
            disabled={!values.recurrence}
          />
        </div>
      </div>

      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {/* A legacy category on an existing session stays selectable —
                otherwise the select silently rewrites it on save. */}
            {(CATEGORIES.includes(values.category)
              ? CATEGORIES
              : [values.category, ...CATEGORIES]
            ).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={values.status}
            onChange={(e) => set("status", e.target.value as SessionStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor="startsAt">Starts at (Eastern Time)</label>
          <input
            id="startsAt"
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="duration">Duration (minutes)</label>
          <input
            id="duration"
            type="number"
            min={5}
            value={values.durationMin}
            onChange={(e) => set("durationMin", Number(e.target.value))}
          />
        </div>
      </div>

      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor="access">Access level</label>
          <select
            id="access"
            value={values.minAccess}
            onChange={(e) => set("minAccess", e.target.value as AccessLevel)}
          >
            {ACCESS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor="capacity">Capacity (optional)</label>
          <input
            id="capacity"
            type="number"
            min={0}
            value={values.capacity ?? ""}
            onChange={(e) =>
              set("capacity", e.target.value ? Number(e.target.value) : null)
            }
          />
        </div>
      </div>

      <div className="admin-form-actions">
        <button type="submit" className="btn-purple" disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Create session"
              : "Save changes"}
        </button>
        <button
          type="button"
          className="btn-mini"
          onClick={() => router.push("/admin/sessions")}
        >
          Cancel
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
