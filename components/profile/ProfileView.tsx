"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PrefDefinition, PrefRow } from "@/lib/notifications";
import {
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
  status: "upcoming" | "enrolled" | "attended" | "live" | "past";
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
    /** Admin-only: title shown next to the Admin badge in community chat. */
    adminTitle: string;
  };
  stats: { sessions: number; daysActive: number };
  sessions: ProfileSessionRow[];
  activity: ProfileActivityRow[];
  prefDefinitions: PrefDefinition[];
  initialPrefs: PrefRow[];
}

type Tab = "activity" | "sessions" | "preferences";

export function ProfileView({
  member,
  profile,
  stats,
  sessions,
  activity,
  prefDefinitions,
  initialPrefs,
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
    admin_title: profile.adminTitle,
  });
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

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
      setMsg(res.message ?? (res.ok ? "Saved" : "Error"));
    });
  }

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateProfile(form);
      setMsg(res.message ?? (res.ok ? "Saved" : "Error"));
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
          </div>
        </div>

        {/* Main */}
        <div>
          <div className="profile-tabs">
            {(
              [
                ["activity", "Activity"],
                ["sessions", "My Sessions"],
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
                      <div
                        className="activity-text"
                        dangerouslySetInnerHTML={{ __html: a.text }}
                      />
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
                  <button type="submit" className="btn-primary" disabled={pending}>
                    {pending ? "Saving…" : "Save profile"}
                  </button>
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
                      {prefDefinitions.map((def) => {
                        const row = prefs.find((p) => p.key === def.key)!;
                        return (
                          <tr key={def.key}>
                            <td>
                              <div className="pref-name">{def.label}</div>
                              <div className="pref-desc">{def.description}</div>
                            </td>
                            <td className="center">
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
                            </td>
                            <td className="center">
                              <input
                                type="checkbox"
                                className="pref-toggle"
                                checked={row.sms}
                                onChange={() => togglePref(def.key, "sms")}
                                aria-label={`${def.label} SMS`}
                              />
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
                    <span style={{ fontSize: 12.5, color: "var(--accent-green)" }}>
                      {msg}
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
