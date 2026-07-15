"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AccessLevel, SessionStatus } from "@/lib/types";
import {
  createSession,
  updateSession,
  type SessionFormValues,
} from "@/app/(portal)/admin/sessions/actions";

const CATEGORIES = ["Leadership", "Wellness", "Business", "Networking"];
const ACCESS: { value: AccessLevel; label: string }[] = [
  { value: "all_members", label: "All members" },
  { value: "vip_plus", label: "VIP & annual+" },
  { value: "pro_only", label: "Pro members only (exclusive)" },
  { value: "admin_only", label: "Admin only" },
];
const STATUSES: SessionStatus[] = [
  "draft",
  "scheduled",
  "live",
  "completed",
  "archived",
];

// Convert an ISO string to a value for <input type="datetime-local">.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function SessionForm({
  mode,
  sessionId,
  initial,
  speakers = [],
}: {
  mode: "create" | "edit";
  sessionId?: string;
  initial?: Partial<SessionFormValues> & { startsAtIso?: string | null };
  /** Speakers already in the system — the session links to one of them. */
  speakers?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [values, setValues] = useState<SessionFormValues>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    category: initial?.category ?? "Leadership",
    startsAt: toLocalInput(initial?.startsAtIso ?? null),
    durationMin: initial?.durationMin ?? 60,
    capacity: initial?.capacity ?? null,
    minAccess: initial?.minAccess ?? "all_members",
    status: initial?.status ?? "draft",
    speakerId: initial?.speakerId ?? "",
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
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      if (res.ok && !res.preview) {
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

      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {CATEGORIES.map((c) => (
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
          <label htmlFor="startsAt">Starts at</label>
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
