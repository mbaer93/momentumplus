"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMember } from "@/app/(portal)/admin/members/actions";

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

export function OrphanAccounts({ orphans }: { orphans: OrphanAccount[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!orphans.length) return null;

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginTop: 18 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        Accounts without a membership
      </div>
      <p style={{ fontSize: 12.5, color: "var(--mid-gray)", margin: "0 0 10px" }}>
        These logins have no membership (interrupted signup or a deleted
        member re-created by a payment retry). They still reserve their email
        — new signups with it are told an account exists. Grant them a
        membership above, or delete the account to free the email.
      </p>
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} style={{ marginBottom: 10 }}>
          {msg.text}
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
            <span style={{ color: "var(--mid-gray)" }}>{o.email}</span>
          </div>
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
        </div>
      ))}
    </div>
  );
}
