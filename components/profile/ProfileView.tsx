"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PrefDefinition, PrefRow } from "@/lib/notifications";
import { PASSWORD_HINT, checkPassword } from "@/lib/password";
import {
  BillingControls,
  type BillingInfo,
} from "@/components/profile/BillingControls";
import {
  changePassword,
  saveNotificationPrefs,
  updateProfile,
} from "@/app/(portal)/profile/actions";

export interface ProfileSessionRow {
  id: string;
  title: string;
  speakerName: string;
  month: string;
  day: string;
  timeLabel: string;
  status: import("@/lib/sessions/view").DisplayStatus;
}

export interface ProfileActivityRow {
  id: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  text: string;
  time: string;
}

interface ProfileViewProps {
  member: {
    name: string;
    email: string;
    initials: string;
    tierLabel: string;
    accessExpiresAt: string | null;
    membershipStatusLabel: string;
    isAdmin: boolean;
  };
  profile: {
    phone: string;
    company: string;
    title: string;
    industry: string;
    bio: string;
    memberSince: string;
    /** Opt-in: share email/phone on the Member Directory. */
    shareContact: boolean;
    /** Admin-only: title shown next to the Admin badge in community chat. */
    adminTitle: string;
  };
  stats: { sessions: number; daysActive: number };
  sessions: ProfileSessionRow[];
  activity: ProfileActivityRow[];
  prefDefinitions: PrefDefinition[];
  initialPrefs: PrefRow[];
  billing: BillingInfo;
  /** Earned course certificates (every lesson complete). */
  certificates: {
    courseId: string;
    title: string;
    ceHours: number | null;
    dateLabel: string;
  }[];
  /** Referral program: the member's share link + conversions so far. */
  referral?: { link: string; count: number } | null;
}

type Tab = "activity" | "sessions" | "certificates" | "preferences";

export function ProfileView({
  member,
  profile,
  stats,
  sessions,
  activity,
  prefDefinitions,
  initialPrefs,
  billing,
  certificates,
  referral = null,
}: ProfileViewProps) {
  const [tab, setTab] = useState<Tab>("activity");
  const [prefs, setPrefs] = useState<PrefRow[]>(initialPrefs);
  const [form, setForm] = useState({
    full_name: member.name,
    phone: profile.phone,
    company: profile.company,
    title: profile.title,
    industry: profile.industry,
    bio: profile.bio,
    share_contact: profile.shareContact,
    admin_title: profile.adminTitle,
  });
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function togglePref(key: string, channel: "email" | "sms" | "in_app") {
    setPrefs((prev) =>
      prev.map((p) =>
        p.key === key ? { ...p, [channel]: !p[channel] } : p,
      ),
    );
  }

  function savePrefs() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveNotificationPrefs(prefs);
      setMsg({ text: res.message ?? (res.ok ? "Saved" : "Error"), ok: res.ok });
    });
  }

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateProfile(form);
      setMsg({ text: res.message ?? (res.ok ? "Saved" : "Error"), ok: res.ok });
    });
  }

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);
  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    const policyError = checkPassword(pw.next);
    if (policyError) {
      setPwMsg({ text: policyError, ok: false });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ text: "The two passwords don't match.", ok: false });
      return;
    }
    startTransition(async () => {
      const res = await changePassword(pw.next, pw.current);
      setPwMsg({ text: res.message ?? (res.ok ? "Changed." : "Error"), ok: res.ok });
      if (res.ok) setPw({ current: "", next: "", confirm: "" });
    });
  }

  return (
    <div className="profile-pad">
      <div className="profile-layout">
        {/* Sidebar */}
        <div>
          <div className="profile-card">
            <div className="profile-banner" />
            <div className="profile-av-wrap">
              <div className="profile-av">{member.initials}</div>
            </div>
            <div className="profile-name">{member.name}</div>
            <div className="profile-tier">{member.tierLabel} · Momentum+</div>
            <div className="profile-stats">
              <div className="profile-stat">
                <div className="profile-stat-val">{stats.sessions}</div>
                <div className="profile-stat-lbl">Sessions</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-val">{stats.daysActive}</div>
                <div className="profile-stat-lbl">Days Active</div>
              </div>
            </div>
          </div>

          <div className="profile-info-card">
            <div className="profile-info-title">Contact Info</div>
            <div className="profile-info-item">{member.email}</div>
            {form.phone && <div className="profile-info-item">{form.phone}</div>}
            <div
              className="profile-info-item"
              style={{ color: "var(--mid-gray)", fontSize: 12 }}
            >
              Member since {profile.memberSince}
            </div>
          </div>

          <div className="profile-info-card">
            <div className="profile-info-title">Membership</div>
            <div className="profile-kv">
              <div className="k">Plan</div>
              <strong>{member.tierLabel}</strong>
            </div>
            <div className="profile-kv">
              <div className="k">
                {member.accessExpiresAt ? "Access through" : "Term"}
              </div>
              <strong>
                {member.accessExpiresAt
                  ? new Date(member.accessExpiresAt).toLocaleDateString(
                      "en-US",
                      { month: "long", day: "numeric", year: "numeric" },
                    )
                  : "Ongoing"}
              </strong>
            </div>
            <div className="profile-kv">
              <div className="k">Status</div>
              <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>
                {member.membershipStatusLabel}
              </span>
            </div>
            <BillingControls billing={billing} />
          </div>

        </div>

        {/* Main */}
        <div>
          {referral && (
            <div
              className="card"
              style={{ marginBottom: 16, padding: "14px 18px" }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "var(--gold)",
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                Refer a leader — earn a free month
              </div>
              <div style={{ fontSize: 13, color: "var(--mid-gray)", marginBottom: 10 }}>
                Share your link. When someone joins with it, you get a month
                free — every time.
                {referral.count > 0 &&
                  ` So far: ${referral.count} member${referral.count === 1 ? "" : "s"} joined through you.`}
              </div>
              <div
                style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
              >
                <code style={{ fontSize: 12, wordBreak: "break-all" }}>
                  {referral.link}
                </code>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => {
                    void navigator.clipboard.writeText(referral.link);
                    setMsg({ text: "Referral link copied", ok: true });
                  }}
                >
                  Copy link
                </button>
              </div>
            </div>
          )}
          <div className="profile-tabs">
            {(
              [
                ["activity", "Activity"],
                ["sessions", "My Sessions"],
                ["certificates", "My Certificates"],
                ["preferences", "Preferences"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`profile-tab${tab === key ? " active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "activity" && (
            <div className="card">
              <div className="card-header">
                <h3>Recent Activity</h3>
              </div>
              <div className="activity-list" style={{ padding: "4px 0" }}>
                {activity.map((a) => (
                  <div className="activity-item" key={a.id}>
                    <div
                      className="activity-avatar"
                      style={{ background: a.iconBg, color: a.iconColor }}
                    >
                      {a.icon}
                    </div>
                    <div className="activity-body">
                      <div className="activity-text">{a.text}</div>
                      <div className="activity-time">{a.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "sessions" && (
            <div className="card">
              <div className="card-header">
                <h3>My Session History</h3>
              </div>
              <div className="upcoming-list">
                {sessions.length === 0 ? (
                  <div style={{ padding: 16, color: "var(--mid-gray)", fontSize: 13 }}>
                    You haven&apos;t enrolled in any sessions yet.{" "}
                    <Link href="/sessions" style={{ color: "var(--gold)" }}>
                      Browse sessions
                    </Link>
                  </div>
                ) : (
                  sessions.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      className="upcoming-item"
                    >
                      <div className="date-box">
                        <div className="date-box-month">{s.month}</div>
                        <div className="date-box-day">{s.day}</div>
                      </div>
                      <div className="upcoming-info">
                        <div className="upcoming-title">{s.title}</div>
                        <div className="upcoming-speaker">{s.speakerName}</div>
                      </div>
                      <div>
                        <div className="upcoming-time">{s.timeLabel}</div>
                        <div style={{ marginTop: 4 }}>
                          <span
                            className={`status-pill ${
                              s.status === "attended" ? "attended" : s.status === "live" ? "live" : s.status === "enrolled" ? "enrolled" : "upcoming"
                            }`}
                          >
                            {s.status === "past" ? "Completed" : s.status}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "certificates" && (
            <div className="card">
              <div className="card-header">
                <h3>My Certificates</h3>
              </div>
              <div style={{ padding: 18 }}>
                {certificates.length === 0 ? (
                  <div style={{ color: "var(--mid-gray)", fontSize: 13 }}>
                    Complete a course in{" "}
                    <Link href="/education" style={{ color: "var(--gold)" }}>
                      Education
                    </Link>{" "}
                    to earn your first certificate.
                  </div>
                ) : (
                  certificates.map((c) => (
                    <div
                      key={c.courseId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        padding: "12px 0",
                        borderBottom: "1px solid var(--warm-gray)",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.title}</div>
                        <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                          Completed {c.dateLabel}
                          {c.ceHours
                            ? ` · ${c.ceHours} CE hour${c.ceHours === 1 ? "" : "s"}`
                            : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <a
                          href={`/api/education/${c.courseId}/certificate`}
                          className="btn-mini"
                          download
                        >
                          Download PDF
                        </a>
                        <Link
                          href={`/education/${c.courseId}/certificate`}
                          className="btn-mini"
                        >
                          View / print
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "preferences" && (
            <div>
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="card-header">
                  <h3>Profile</h3>
                </div>
                <form onSubmit={saveProfile} style={{ padding: 18 }}>
                  <div className="admin-field-row">
                    <div className="admin-field">
                      <label htmlFor="pf-name">Full name</label>
                      <input
                        id="pf-name"
                        value={form.full_name}
                        onChange={(e) =>
                          setForm({ ...form, full_name: e.target.value })
                        }
                      />
                    </div>
                    <div className="admin-field">
                      <label htmlFor="pf-phone">
                        Phone (required for SMS notifications)
                      </label>
                      <input
                        id="pf-phone"
                        value={form.phone}
                        onChange={(e) =>
                          setForm({ ...form, phone: e.target.value })
                        }
                        placeholder="+1 (555) 555-5555"
                      />
                    </div>
                  </div>
                  <div className="admin-field-row">
                    <div className="admin-field">
                      <label htmlFor="pf-company">Company</label>
                      <input
                        id="pf-company"
                        value={form.company}
                        onChange={(e) =>
                          setForm({ ...form, company: e.target.value })
                        }
                      />
                    </div>
                    <div className="admin-field">
                      <label htmlFor="pf-title">Title</label>
                      <input
                        id="pf-title"
                        value={form.title}
                        onChange={(e) =>
                          setForm({ ...form, title: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="admin-field">
                    <label htmlFor="pf-industry">Industry</label>
                    <input
                      id="pf-industry"
                      value={form.industry}
                      onChange={(e) =>
                        setForm({ ...form, industry: e.target.value })
                      }
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="pf-bio">Bio</label>
                    <textarea
                      id="pf-bio"
                      value={form.bio}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    />
                  </div>
                  <label className="admin-check-row">
                    <input
                      type="checkbox"
                      className="pref-toggle"
                      checked={form.share_contact}
                      onChange={(e) =>
                        setForm({ ...form, share_contact: e.target.checked })
                      }
                    />
                    <span>
                      Share my contact info in the Member Directory — other
                      members can see my email
                      {" "}and phone. Off by default; your name, title, and
                      company are always listed.
                    </span>
                  </label>
                  {member.isAdmin && (
                    <div className="admin-field">
                      <label htmlFor="pf-admin-title">
                        Admin title — shown with your Admin badge in Community
                        (e.g. &ldquo;Co-Founder, TSLS&rdquo;)
                      </label>
                      <input
                        id="pf-admin-title"
                        value={form.admin_title}
                        onChange={(e) =>
                          setForm({ ...form, admin_title: e.target.value })
                        }
                        placeholder="Momentum+ Team"
                      />
                    </div>
                  )}
                  <div className="admin-form-actions">
                    <button type="submit" className="btn-primary" disabled={pending}>
                      {pending ? "Saving…" : "Save profile"}
                    </button>
                    {msg && (
                      <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
                        {msg.text}
                      </span>
                    )}
                  </div>
                </form>
              </div>

              <div className="card" style={{ marginBottom: 18 }}>
                <div className="card-header">
                  <h3>Password</h3>
                </div>
                <form onSubmit={savePassword} style={{ padding: 18 }}>
                  <div className="admin-field" style={{ maxWidth: 320 }}>
                    <label htmlFor="pw-current">Current password</label>
                    <input
                      id="pw-current"
                      type="password"
                      autoComplete="current-password"
                      value={pw.current}
                      onChange={(e) => setPw({ ...pw, current: e.target.value })}
                      placeholder="Confirm it's you"
                    />
                  </div>
                  <div className="admin-field-row">
                    <div className="admin-field">
                      <label htmlFor="pw-next">New password</label>
                      <input
                        id="pw-next"
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        value={pw.next}
                        onChange={(e) => setPw({ ...pw, next: e.target.value })}
                        placeholder="Choose a strong password"
                      />
                    </div>
                    <div className="admin-field">
                      <label htmlFor="pw-confirm">Confirm new password</label>
                      <input
                        id="pw-confirm"
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        value={pw.confirm}
                        onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                      />
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--mid-gray)", margin: "2px 0 10px" }}>
                    {PASSWORD_HINT}
                  </p>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={pending || pw.next.length < 8 || !pw.current}
                  >
                    {pending ? "Saving…" : "Change password"}
                  </button>
                  {pwMsg && (
                    <span
                      className={`admin-form-msg ${pwMsg.ok ? "ok" : "err"}`}
                      style={{ marginLeft: 10 }}
                    >
                      {pwMsg.text}
                    </span>
                  )}
                </form>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3>Notification Preferences</h3>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="prefs-table">
                    <thead>
                      <tr>
                        <th>Notification</th>
                        <th className="center">Email</th>
                        <th className="center">SMS</th>
                        <th className="center">In-app</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Only categories with a real sender behind them —
                          toggles that control nothing erode trust. */}
                      {prefDefinitions
                        .filter((def) => !def.hidden)
                        .map((def) => {
                          const row = prefs.find((p) => p.key === def.key)!;
                          return (
                            <tr key={def.key}>
                              <td>
                                <div className="pref-name">{def.label}</div>
                                <div className="pref-desc">{def.description}</div>
                              </td>
                              <td className="center">
                                {def.inAppOnly ? (
                                  <span
                                    style={{ color: "var(--mid-gray)", fontSize: 12 }}
                                    title="Delivered in-app only"
                                  >
                                    —
                                  </span>
                                ) : (
                                  <>
                                    <input
                                      type="checkbox"
                                      className="pref-toggle"
                                      checked={row.email}
                                      disabled={def.emailLocked}
                                      onChange={() => togglePref(def.key, "email")}
                                      aria-label={`${def.label} email`}
                                    />
                                    {def.emailLocked && (
                                      <div className="pref-locked-note">Always on</div>
                                    )}
                                  </>
                                )}
                              </td>
                              <td className="center">
                                {def.inAppOnly ? (
                                  <span
                                    style={{ color: "var(--mid-gray)", fontSize: 12 }}
                                    title="Delivered in-app only"
                                  >
                                    —
                                  </span>
                                ) : (
                                  <input
                                    type="checkbox"
                                    className="pref-toggle"
                                    checked={row.sms}
                                    onChange={() => togglePref(def.key, "sms")}
                                    aria-label={`${def.label} SMS`}
                                  />
                                )}
                              </td>
                              <td className="center">
                                <input
                                  type="checkbox"
                                  className="pref-toggle"
                                  checked={row.in_app}
                                  onChange={() => togglePref(def.key, "in_app")}
                                  aria-label={`${def.label} in-app`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="prefs-save-row">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={savePrefs}
                    disabled={pending}
                  >
                    {pending ? "Saving…" : "Save preferences"}
                  </button>
                  <span style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                    SMS is strictly opt-in and requires a phone number.
                  </span>
                  {msg && (
                    <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
                      {msg.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
