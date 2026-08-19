"use client";

import { useState, useTransition } from "react";
import { mergeSpeakers } from "@/app/(portal)/admin/speakers/actions";

export interface DuplicateSpeakerRow {
  id: string;
  name: string;
  title: string | null;
  createdAt: string | null;
  hasHeadshot: boolean;
  hasBio: boolean;
  sessionCount: number;
}

export interface DuplicateGroup {
  key: string;
  rows: DuplicateSpeakerRow[];
}

/*
 * Possible-duplicate review (Matt, 2026-08-11).
 *
 * A TSLS pull whose name matching missed created a second row for people
 * already listed. This shows each pair and merges on request: the row you
 * keep wins every field it already has, the other one's values fill its
 * blanks, its sessions are moved across, and only then is it deleted.
 *
 * Deliberately not automatic. Two people can legitimately share a name,
 * and merging them would cost a speaker their identity in a way that
 * isn't obvious afterwards — so a human picks which row survives.
 */
export function DuplicateSpeakersPanel({ groups }: { groups: DuplicateGroup[] }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const remaining = groups.filter((g) => !done.has(g.key));
  if (remaining.length === 0 && !status) return null;

  return (
    <div
      style={{
        border: "1px solid rgba(184, 150, 90, 0.45)",
        background: "var(--gold-pale)",
        borderRadius: 4,
        padding: "16px 18px",
        margin: "18px 0 24px",
      }}
    >
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>
        Possible duplicate speakers
      </h3>
      <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", marginBottom: 12 }}>
        These rows look like one person: the same name once titles,
        credentials and punctuation are ignored, or the same account or
        contact email. Usually a TSLS pull that couldn&apos;t match an existing
        listing, or a speaker who completed setup while already listed under a
        different form of their name. Keep the row with the real profile on
        it; the other one&apos;s details fill any blanks and its sessions move
        across before it is removed.
      </p>

      {remaining.map((group) => (
        <div
          key={group.key}
          style={{
            background: "#fff",
            border: "1px solid var(--warm-gray)",
            borderRadius: 4,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {group.rows.map((row) => (
              <div
                key={row.id}
                style={{
                  flex: "1 1 230px",
                  minWidth: 0,
                  border: "1px solid var(--warm-gray)",
                  borderRadius: 4,
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                  {row.title || "No title"}
                </div>
                <div
                  style={{ fontSize: 11.5, color: "var(--ink-secondary)", marginTop: 4 }}
                >
                  {row.hasHeadshot ? "Headshot" : "No headshot"} ·{" "}
                  {row.hasBio ? "Bio" : "No bio"} · {row.sessionCount} session
                  {row.sessionCount === 1 ? "" : "s"}
                  {row.createdAt
                    ? ` · added ${new Date(row.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}`
                    : ""}
                </div>
                <button
                  type="button"
                  className="btn-mini"
                  style={{ marginTop: 8 }}
                  disabled={pending}
                  onClick={() => {
                    const drop = group.rows.find((r) => r.id !== row.id);
                    if (!drop) return;
                    if (
                      !confirm(
                        `Keep "${row.name}" and merge "${drop.name}" into it?\n\n` +
                          `"${drop.name}" will be deleted. Its sessions move to the row you keep, ` +
                          `and any details it has that this row is missing are copied over. ` +
                          `Nothing already filled in on "${row.name}" is changed.`,
                      )
                    ) {
                      return;
                    }
                    startTransition(async () => {
                      const res = await mergeSpeakers(row.id, drop.id);
                      setStatus({
                        ok: res.ok,
                        text: res.message ?? (res.ok ? "Merged" : "Merge failed"),
                      });
                      if (res.ok) setDone((prev) => new Set(prev).add(group.key));
                    });
                  }}
                >
                  Keep this one
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {status && (
        <div
          style={{
            fontSize: 12.5,
            marginTop: 4,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
