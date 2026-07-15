"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Tier } from "@/lib/types";
import { ADMIN_AREAS } from "@/lib/admin-perms";
import {
  expireMembership,
  extendMembership,
  grantMembership,
  setAdminAccess,
  updateMemberProfile,
} from "@/app/(portal)/admin/members/actions";

export interface AdminMemberRow {
  membershipId: string;
  profileId: string;
  name: string;
  email: string;
  tier: string;
  tierLabel: string;
  status: string;
  expiresLabel: string;
  source: string;
  profileTitle: string;
  profileCompany: string;
  profilePhone: string;
  adminRole: "super" | "standard" | null;
  adminPerms: Record<string, boolean>;
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

export function MembersManager({
  members,
  viewerIsSuper = false,
}: {
  members: AdminMemberRow[];
  /** Super Admin sees admin-access controls on admin members. */
  viewerIsSuper?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [grant, setGrant] = useState({ email: "", tier: "sub_monthly" as Tier, months: 1 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    title: "",
    company: "",
    phone: "",
  });
  const [accessForm, setAccessForm] = useState<{
    role: "super" | "standard";
    perms: Record<string, boolean>;
  }>({ role: "standard", perms: {} });

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ?? (res.ok ? "Done." : "Error"));
        if (res.ok) router.refresh();
      } catch {
        setMsg("That didn't save — please try again.");
      }
    });
  }

  function beginEdit(m: AdminMemberRow) {
    setEditingId(m.membershipId);
    setProfileForm({
      fullName: m.name === "—" ? "" : m.name,
      title: m.profileTitle,
      company: m.profileCompany,
      phone: m.profilePhone,
    });
    setAccessForm({
      role: m.adminRole === "super" ? "super" : "standard",
      perms: { ...m.adminPerms },
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
              {TIERS.filter((t) => viewerIsSuper || t.value !== "admin").map(
                (t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ),
              )}
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
              <Fragment key={m.membershipId}>
              <tr>
                <td>
                  <div className="admin-row-title">
                    {m.name}
                    {m.adminRole === "super" && (
                      <span
                        className="admin-status draft"
                        style={{ marginLeft: 8 }}
                      >
                        Super Admin
                      </span>
                    )}
                  </div>
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
                      onClick={() =>
                        editingId === m.membershipId
                          ? setEditingId(null)
                          : beginEdit(m)
                      }
                    >
                      {editingId === m.membershipId ? "Close" : "Edit"}
                    </button>
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
              {editingId === m.membershipId && (
                <tr>
                  <td colSpan={6} style={{ background: "#fbfaf8" }}>
                    <div style={{ padding: "6px 4px" }}>
                      <div
                        className="admin-field-row"
                        style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1fr" }}
                      >
                        <div className="admin-field">
                          <label htmlFor={`edit-name-${m.membershipId}`}>
                            Full name
                          </label>
                          <input
                            id={`edit-name-${m.membershipId}`}
                            value={profileForm.fullName}
                            onChange={(e) =>
                              setProfileForm({
                                ...profileForm,
                                fullName: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="admin-field">
                          <label htmlFor={`edit-title-${m.membershipId}`}>
                            Title
                          </label>
                          <input
                            id={`edit-title-${m.membershipId}`}
                            value={profileForm.title}
                            onChange={(e) =>
                              setProfileForm({
                                ...profileForm,
                                title: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="admin-field">
                          <label htmlFor={`edit-company-${m.membershipId}`}>
                            Company
                          </label>
                          <input
                            id={`edit-company-${m.membershipId}`}
                            value={profileForm.company}
                            onChange={(e) =>
                              setProfileForm({
                                ...profileForm,
                                company: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="admin-field">
                          <label htmlFor={`edit-phone-${m.membershipId}`}>
                            Phone
                          </label>
                          <input
                            id={`edit-phone-${m.membershipId}`}
                            value={profileForm.phone}
                            onChange={(e) =>
                              setProfileForm({
                                ...profileForm,
                                phone: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="admin-form-actions" style={{ marginTop: 4 }}>
                        <button
                          type="button"
                          className="btn-purple"
                          disabled={pending || !profileForm.fullName.trim()}
                          onClick={() =>
                            run(() => updateMemberProfile(m.profileId, profileForm))
                          }
                        >
                          Save member
                        </button>
                      </div>

                      {viewerIsSuper && m.tier === "admin" && (
                        <div style={{ marginTop: 14 }}>
                          <div className="admin-field" style={{ marginBottom: 6 }}>
                            <label style={{ fontSize: 13 }}>
                              Admin access (Super Admin only)
                            </label>
                          </div>
                          <div
                            className="admin-form-actions"
                            style={{ marginTop: 0, flexWrap: "wrap" }}
                          >
                            <select
                              value={accessForm.role}
                              onChange={(e) =>
                                setAccessForm({
                                  ...accessForm,
                                  role:
                                    e.target.value === "super"
                                      ? "super"
                                      : "standard",
                                })
                              }
                              aria-label="Admin role"
                            >
                              <option value="standard">Standard admin</option>
                              <option value="super">Super Admin</option>
                            </select>
                            {accessForm.role === "standard" &&
                              ADMIN_AREAS.map((a) => (
                                <label
                                  key={a.key}
                                  className="admin-check-row"
                                  style={{ margin: 0, fontSize: 12.5 }}
                                >
                                  <input
                                    type="checkbox"
                                    className="pref-toggle"
                                    checked={accessForm.perms[a.key] !== false}
                                    onChange={(e) =>
                                      setAccessForm({
                                        ...accessForm,
                                        perms: {
                                          ...accessForm.perms,
                                          [a.key]: e.target.checked,
                                        },
                                      })
                                    }
                                  />
                                  {a.label}
                                </label>
                              ))}
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  setAdminAccess(
                                    m.profileId,
                                    accessForm.role,
                                    accessForm.perms,
                                  ),
                                )
                              }
                            >
                              Save access
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
