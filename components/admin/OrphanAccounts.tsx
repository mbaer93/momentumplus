"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BreakableEmail } from "@/components/BreakableEmail";
import {
  deleteMember,
  getLoginLink,
  resendInvite,
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
  /*
   * Keyed by the row that was clicked, not panel-wide (Matt, 2026-08-19:
   * "I clicked 'get sign in link' nothing happened that I can tell"). The
   * result used to render at the TOP of the panel, so on a list long enough
   * to scroll, clicking a bottom row put the answer off-screen and the
   * button looked dead.
   */
  const [result, setResult] = useState<{
    profileId: string;
    ok: boolean;
    text: string;
    link?: string | null;
  } | null>(null);

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
    profileId: string,
    fn: () => Promise<{ ok: boolean; message?: string; loginLink?: string | null }>,
  ) => {
    setResult({ profileId, ok: true, text: "Working…" });
    startTransition(async () => {
      try {
        const res = await fn();
        setResult({
          profileId,
          ok: res.ok,
          text: res.message ?? (res.ok ? "Done." : "Error"),
          link: res.loginLink ?? null,
        });
      } catch {
        setResult({
          profileId,
          ok: false,
          text: "That didn't go through — try again.",
        });
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
        email, so new signups with it are told an account exists. Re-send
        their invite, email them a password reset, or copy a one-time sign-in
        link to get someone moving — grant them a membership above, or delete
        the account to free the email.
      </p>
      {orphans.map((o) => (
        <div
          key={o.profileId}
          style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
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
                onClick={() => run(o.profileId, () => resendInvite(o.email))}
              >
                Resend invite
              </button>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => run(o.profileId, () => sendPasswordReset(o.email))}
              >
                Send password reset
              </button>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => run(o.profileId, () => getLoginLink(o.email))}
              >
                Get sign-in link
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
                    run(o.profileId, async () => {
                      const res = await deleteMember(o.profileId);
                      if (res.ok) router.refresh();
                      return res;
                    });
                  }}
                >
                  Delete account
                </button>
              )}
            </div>
          </div>
          {result?.profileId === o.profileId && (
            <div style={{ marginTop: 8 }}>
              <div className={`admin-form-msg ${result.ok ? "ok" : "err"}`}>
                {result.text}
              </div>
              {result.link && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginTop: 8,
                  }}
                >
                  <code style={{ fontSize: 11, wordBreak: "break-all", flex: 1 }}>
                    {result.link}
                  </code>
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.link ?? "");
                    }}
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
