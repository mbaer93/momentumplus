"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Tier } from "@/lib/types";
import {
  expireMembership,
  extendMembership,
  grantMembership,
} from "@/app/(portal)/admin/members/actions";

export interface AdminMemberRow {
  membershipId: string;
  name: string;
  email: string;
  tier: string;
  tierLabel: string;
  status: string;
  expiresLabel: string;
  source: string;
}

const TIERS: { value: Tier; label: string }[] = [
  { value: "sub_monthly", label: "Monthly" },
  { value: "sub_3mo", label: "3-Month" },
  { value: "sub_6mo", label: "6-Month" },
  { value: "sub_annual", label: "12-Month" },
  { value: "tsls_attendee", label: "TSLS Attendee" },
  { value: "tsls_vip", label: "TSLS VIP" },
  { value: "speaker", label: "Speaker" },
  { value: "admin", label: "Admin" },
];

export function MembersManager({ members }: { members: AdminMemberRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [grant, setGrant] = useState({ email: "", tier: "sub_monthly" as Tier, months: 1 });

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.message ?? (res.ok ? "Done." : "Error"));
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      {/* Grant form */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field-row" style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}>
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="grant-email">Grant membership — email</label>
            <input
              id="grant-email"
              type="email"
              placeholder="member@example.com"
              value={grant.email}
              onChange={(e) => setGrant({ ...grant, email: e.target.value })}
            />
          </div>
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="grant-tier">Tier</label>
            <select
              id="grant-tier"
              value={grant.tier}
              onChange={(e) => setGrant({ ...grant, tier: e.target.value as Tier })}
            >
              {TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label htmlFor="grant-months">Months (0 = ongoing)</label>
            <input
              id="grant-months"
              type="number"
              min={0}
              value={grant.months}
              onChange={(e) => setGrant({ ...grant, months: Number(e.target.value) })}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="btn-purple"
              disabled={pending || !grant.email.includes("@")}
              onClick={() => run(() => grantMembership(grant))}
            >
              Grant
            </button>
          </div>
        </div>
        {msg && (
          <div className="admin-form-msg ok" style={{ marginTop: 10 }}>
            {msg}
          </div>
        )}
      </div>

      {/* Members table */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Access through</th>
              <th>Source</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId}>
                <td>
                  <div className="admin-row-title">{m.name}</div>
                  <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                    {m.email}
                  </div>
                </td>
                <td>{m.tierLabel}</td>
                <td>
                  <span
                    className={`admin-status ${
                      m.status === "active"
                        ? "completed"
                        : m.status === "past_due"
                          ? "live"
                          : "draft"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td>{m.expiresLabel}</td>
                <td style={{ color: "var(--mid-gray)", fontSize: 12 }}>{m.source}</td>
                <td>
                  <div className="admin-actions-cell" style={{ justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn-mini"
                      disabled={pending}
                      onClick={() => run(() => extendMembership(m.membershipId, 1))}
                    >
                      +1 mo
                    </button>
                    <button
                      type="button"
                      className="btn-mini danger"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`Expire ${m.name}'s membership?`)) {
                          run(() => expireMembership(m.membershipId));
                        }
                      }}
                    >
                      Expire
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
