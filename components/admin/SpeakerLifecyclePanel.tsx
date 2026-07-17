"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveSpeaker,
  inviteSpeaker,
  reinstateSpeaker,
} from "@/app/(portal)/admin/speakers/actions";

export interface PastSpeakerRow {
  id: string;
  name: string;
  title: string;
  archivedAt: string | null;
  expiresAt: string | null;
}

export interface PendingSpeakerInvite {
  email: string;
  displayName: string;
  createdAt: string;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/*
 * Speaker lifecycle controls: self-service invites (the speaker builds their
 * own page, business resource, and profile), a list of invites still being
 * waited on, and the Past Speakers archive with reinstate. Archiving a
 * speaker also archives their sessions and library items — nothing is
 * deleted, and reinstating restores access through the next season end.
 */
export function SpeakerLifecyclePanel({
  activeSpeakers,
  pastSpeakers,
  pendingInvites,
}: {
  activeSpeakers: { id: string; name: string; expiresAt: string | null }[];
  pastSpeakers: PastSpeakerRow[];
  pendingInvites: PendingSpeakerInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [invite, setInvite] = useState({ email: "", name: "" });
  const [inviteMsg, setInviteMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — try again.", ok: false });
      }
    });
  }

  return (
    <>
      {/* Invite: enter the speaker's email, they build everything else. */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 13 }}>Invite a speaker</label>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
          Enter the speaker&apos;s email. They get an email that walks them
          through building their speaker page, personal profile, and a business
          resource page — no data entry on your side. Speakers get Pro-level
          access plus their own Speaker Studio (edit their pages, start their
          Zoom sessions, message enrollees), through October&nbsp;1 of next
          year.
        </div>
        <div
          className="admin-field-row"
          style={{ gridTemplateColumns: "1.4fr 1.2fr auto", alignItems: "end" }}
        >
          <div className="admin-field">
            <label htmlFor="spk-invite-email">Speaker email</label>
            <input
              id="spk-invite-email"
              type="email"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              placeholder="speaker@theirdomain.com"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="spk-invite-name">Name (optional prefill)</label>
            <input
              id="spk-invite-name"
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              placeholder="They can edit this"
            />
          </div>
          <button
            type="button"
            className="btn-mini"
            disabled={pending || !invite.email.includes("@")}
            onClick={() => {
              setInviteMsg(null);
              setInviteLink(null);
              startTransition(async () => {
                const res = await inviteSpeaker(invite.email, invite.name);
                setInviteMsg(res.message ? { text: res.message, ok: res.ok } : null);
                setInviteLink(res.loginLink ?? null);
                if (res.ok) {
                  setInvite({ email: "", name: "" });
                  router.refresh();
                }
              });
            }}
          >
            Send invite
          </button>
        </div>
        {inviteMsg && (
          <div className={`admin-form-msg ${inviteMsg.ok ? "ok" : "err"}`}>
            {inviteMsg.text}
          </div>
        )}
        {inviteLink && (
          <div
            className="admin-form-actions"
            style={{ marginTop: 8, alignItems: "center" }}
          >
            <code style={{ fontSize: 11, wordBreak: "break-all", flex: 1 }}>
              {inviteLink}
            </code>
            <button
              type="button"
              className="btn-mini"
              onClick={() => void navigator.clipboard.writeText(inviteLink)}
            >
              Copy link
            </button>
          </div>
        )}
        {pendingInvites.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--mid-gray)" }}>
            Waiting on:{" "}
            {pendingInvites
              .map(
                (i) =>
                  `${i.email}${i.displayName ? ` (${i.displayName})` : ""} — invited ${dateLabel(i.createdAt)}`,
              )
              .join(" · ")}
          </div>
        )}
      </div>

      {/* Season / archive controls for current speakers. */}
      {activeSpeakers.length > 0 && (
        <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
          <div className="admin-field" style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 13 }}>Current season</label>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 8 }}>
            Speakers come down automatically at their season end. Archiving
            early hides the speaker <em>and</em> their sessions and library
            items from members — nothing is deleted, and you can reinstate
            them below anytime.
          </div>
          {activeSpeakers.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                borderBottom: "1px solid var(--warm-gray)",
              }}
            >
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong>{s.name}</strong>
                <span
                  style={{ color: "var(--mid-gray)", marginLeft: 8, fontSize: 12 }}
                >
                  {s.expiresAt
                    ? `Season ends ${dateLabel(s.expiresAt)}`
                    : "No season end set"}
                </span>
              </div>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                title="Move to Past Speakers (hidden from members, reversible)"
                onClick={() => {
                  if (
                    confirm(
                      `Archive ${s.name}? Their speaker page, sessions, and library items disappear from member view and their access ends — nothing is deleted, and you can reinstate them anytime.`,
                    )
                  ) {
                    run(() => archiveSpeaker(s.id));
                  }
                }}
              >
                Archive
              </button>
            </div>
          ))}
          {msg && (
            <div
              className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
              style={{ marginTop: 8 }}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}

      {pastSpeakers.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="admin-field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 13 }}>
              Past speakers ({pastSpeakers.length}) — hidden from members
            </label>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Speaker</th>
                  <th>Season ended</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pastSpeakers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="admin-row-title">{s.name}</div>
                      {s.title && (
                        <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                          {s.title}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                      {s.archivedAt
                        ? `Archived ${dateLabel(s.archivedAt)}`
                        : s.expiresAt
                          ? `Expired ${dateLabel(s.expiresAt)}`
                          : "—"}
                    </td>
                    <td>
                      <div
                        className="admin-actions-cell"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <button
                          type="button"
                          className="btn-mini"
                          disabled={pending}
                          onClick={() => {
                            if (
                              confirm(
                                `Reinstate ${s.name}? Their speaker page and library items return for members and their Studio access is restored through the next season end. Their sessions stay archived — re-publish the ones you want back from Admin → Sessions.`,
                              )
                            ) {
                              run(() => reinstateSpeaker(s.id));
                            }
                          }}
                        >
                          Reinstate speaker
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
