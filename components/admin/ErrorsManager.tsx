"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearError,
  notifyAffected,
  type ErrorsResult,
} from "@/app/(portal)/admin/errors/actions";

export interface ErrorReportRow {
  hash: string;
  message: string;
  path: string;
  count: number;
  affected: number;
  firstSeen: string;
  lastSeen: string;
  usersNotifiedAt: string | null;
}

/* Prefilled so the honest "we're on it" note is two clicks, not a blank
   page — but the admin can rewrite every word before sending. */
const DEFAULT_SUBJECT = "We hit a snag — we're on it";
const defaultBody = (path: string) =>
  `You may have run into an error screen on Momentum+${path ? ` (${path})` : ""} a little while ago.

We've spotted the problem and we're actively working on the fix — you don't need to do anything, and nothing on your account was affected.

Thanks for your patience. If anything still looks off in a little while, just reply to this email and we'll take a look.`;

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ErrorsManager({ reports }: { reports: ErrorReportRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState("");

  function run(fn: () => Promise<ErrorsResult>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Done." : "Error") });
      if (res.ok) router.refresh();
    });
  }

  if (reports.length === 0) {
    return (
      <div className="admin-hint">
        No open error reports — the platform is healthy. Crash screens members
        hit will appear here, with who was affected and a one-click note to
        let them know you&apos;re on it.
      </div>
    );
  }

  return (
    <>
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} role="status">
          {msg.text}
        </div>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Error</th>
              <th style={{ width: 90 }}>Times</th>
              <th style={{ width: 110 }}>Affected</th>
              <th style={{ width: 110 }}>Last seen</th>
              <th style={{ width: 210 }} />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => {
              const composing = open === r.hash;
              return (
                <Fragment key={r.hash}>
                  <tr>
                    <td>
                      <div className="admin-row-title">
                        {r.path || "unknown page"}
                      </div>
                      <div className="cc-sub">{r.message.slice(0, 140)}</div>
                    </td>
                    <td>{r.count}</td>
                    <td>
                      {r.affected}
                      {r.usersNotifiedAt && (
                        <div className="cc-sub">
                          notified {ago(r.usersNotifiedAt)}
                        </div>
                      )}
                    </td>
                    <td>{ago(r.lastSeen)}</td>
                    <td>
                      <div className="admin-actions-cell">
                        <button
                          type="button"
                          className="btn-mini"
                          disabled={pending || r.affected === 0}
                          title={
                            r.affected === 0
                              ? "No members recorded on this error"
                              : undefined
                          }
                          onClick={() => {
                            if (composing) {
                              setOpen(null);
                              return;
                            }
                            setOpen(r.hash);
                            setSubject(DEFAULT_SUBJECT);
                            setBody(defaultBody(r.path));
                          }}
                        >
                          {composing ? "Close" : "Email affected"}
                        </button>
                        <button
                          type="button"
                          className="btn-mini danger"
                          disabled={pending}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Clear this error report? Its affected-member list goes with it.",
                              )
                            ) {
                              run(() => clearError(r.hash));
                            }
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                  {composing && (
                    <tr className="topic-editor-row">
                      <td colSpan={5}>
                        <div className="topic-editor">
                          <div className="admin-field">
                            <label htmlFor={`subj-${r.hash}`}>Subject</label>
                            <input
                              id={`subj-${r.hash}`}
                              value={subject}
                              onChange={(e) => setSubject(e.target.value)}
                            />
                          </div>
                          <div className="admin-field">
                            <label htmlFor={`body-${r.hash}`}>
                              Message — goes to the {r.affected} affected
                              member{r.affected === 1 ? "" : "s"} by email and
                              in-app notification
                            </label>
                            <textarea
                              id={`body-${r.hash}`}
                              rows={6}
                              value={body}
                              onChange={(e) => setBody(e.target.value)}
                            />
                          </div>
                          <div className="admin-form-actions">
                            <button
                              type="button"
                              className="btn-purple"
                              disabled={pending}
                              onClick={() => {
                                run(() => notifyAffected(r.hash, subject, body));
                                setOpen(null);
                              }}
                            >
                              {pending ? "Sending…" : "Send to affected members"}
                            </button>
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={() => setOpen(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
