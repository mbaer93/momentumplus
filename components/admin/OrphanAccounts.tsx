"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BreakableEmail } from "@/components/BreakableEmail";
import {
  deleteMember,
  getLoginLink,
  sendPasswordReset,
} from "@/app/(portal)/admin/members/actions";

/*
 * Accounts that exist (a login + profile) but hold NO membership row. The
 * members table starts from memberships, so without this list these
 * accounts would be invisible here while still blocking their email on
 * /join ("you already have an account"). They appear when a signup is
 * interrupted or a deletion races a Stripe webhook retry.
 */
export interface OrphanAccount {
  profileId: string;
  name: string;
  email: string;
}

export function OrphanAccounts({
  orphans,
  canDelete,
}: {
  orphans: OrphanAccount[];
  /** Deleting a login is Super Admin only; the recovery actions are not. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (!orphans.length) return null;

  /*
   * These are the people most likely to need help, and until now the only
   * button here was Delete (Matt, 2026-08-19: went looking for a speaker to
   * send a sign-in link to, and he was not in the members table at all —
   * the table inner-joins memberships, and his arrives only when he
   * finishes his setup form).
   *
   * A sign-in link works whatever state their password is in, which is the
   * usual reason someone is stuck.
   */
  const run = (
    fn: () => Promise<{ ok: boolean; message?: string; loginLink?: string | null }>,
  ) => {
    setMsg(null);
    setLink(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Done." : "Error") });
        if (res.loginLink) setLink(res.loginLink);
      } catch {
        setMsg({ ok: false, text: "That didn't go through — try again." });
      }
    });
  };

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginTop: 18 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        Accounts without a membership
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", margin: "0 0 10px" }}>
        These logins have no membership, so they do NOT appear in the table
        above — most often a speaker or sponsor who signed in but hasn&apos;t
        finished their setup form yet (their membership is created when they
        submit it), sometimes an interrupted signup. They still reserve their
        email, so new signups with it are told an account exists. Send a
        sign-in link to get someone moving, grant them a membership above, or
        delete the account to free the email.
      </p>
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} style={{ marginBottom: 10 }}>
          {msg.text}
        </div>
      )}
      {link && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <code style={{ fontSize: 11, wordBreak: "break-all", flex: 1 }}>
            {link}
          </code>
          <button
            type="button"
            className="btn-mini"
            onClick={() => void navigator.clipboard.writeText(link)}
          >
            Copy
          </button>
        </div>
      )}
      {orphans.map((o) => (
        <div
          key={o.profileId}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 0",
            borderTop: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13 }}>
            <strong>{o.name || "—"}</strong>{" "}
            <span style={{ color: "var(--ink-secondary)" }}>
              <BreakableEmail email={o.email} />
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-mini"
            disabled={pending}
            onClick={() => run(() => getLoginLink(o.email))}
          >
            Get sign-in link
          </button>
          <button
            type="button"
            className="btn-mini"
            disabled={pending}
            onClick={() => run(() => sendPasswordReset(o.email))}
          >
            Send password reset
          </button>
          {canDelete && (
          <button
            type="button"
            className="btn-mini danger"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  `Delete the account for ${o.email}? This removes their login permanently and frees the email for a fresh signup.`,
                )
              ) {
                return;
              }
              setMsg(null);
              startTransition(async () => {
                try {
                  const res = await deleteMember(o.profileId);
                  setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Deleted." : "Error") });
                  if (res.ok) router.refresh();
                } catch {
                  setMsg({ ok: false, text: "That didn't go through — try again." });
                }
              });
            }}
          >
            Delete account
          </button>
          )}
          </div>
        </div>
      ))}
    </div>
  );
}
