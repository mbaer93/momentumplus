import Link from "next/link";
import {
  AdminIcon,
  ChevronRightIcon,
  CommunityIcon,
  SessionsIcon,
  SpeakersIcon,
  SponsorsIcon,
} from "@/components/icons";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listSessions } from "@/lib/sessions/queries";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/admin/sessions",
    icon: SessionsIcon,
    title: "Sessions",
    desc: "Create, publish (creates the Zoom meeting), and manage sessions.",
  },
  {
    href: "/admin/members",
    icon: SpeakersIcon,
    title: "Members",
    desc: "Memberships, manual grants, extensions, and access.",
  },
  {
    href: "/admin/announcements",
    icon: CommunityIcon,
    title: "Announcements",
    desc: "Compose and send to members by tier and channel.",
  },
  {
    href: "/admin/sponsors",
    icon: SponsorsIcon,
    title: "Sponsors",
    desc: "Partners, rail placement, impressions and clicks.",
  },
];

export default async function AdminPage() {
  // Stats: live counts when connected; illustrative numbers in preview.
  let stats = {
    members: 142,
    activeMemberships: 128,
    upcomingSessions: 3,
    pastDue: 4,
  };

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const [profiles, active, pastDue] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      admin
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("status", "past_due"),
    ]);
    const sessions = await listSessions();
    stats = {
      members: profiles.count ?? 0,
      activeMemberships: active.count ?? 0,
      upcomingSessions: sessions.filter(
        (s) => new Date(s.startsAt).getTime() > Date.now(),
      ).length,
      pastDue: pastDue.count ?? 0,
    };
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Admin Panel</h2>
          <p>Manage the Momentum+ portal</p>
        </div>
        <span
          className="admin-status draft"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <AdminIcon size={12} /> Admin access
        </span>
      </div>

      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-val">{stats.members}</div>
          <div className="admin-stat-lbl">Members</div>
          <div className="admin-stat-sub">All profiles</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-val">{stats.activeMemberships}</div>
          <div className="admin-stat-lbl">Active memberships</div>
          <div className="admin-stat-sub">Status: active</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-val">{stats.upcomingSessions}</div>
          <div className="admin-stat-lbl">Upcoming sessions</div>
          <div className="admin-stat-sub">Scheduled ahead</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-val">{stats.pastDue}</div>
          <div className="admin-stat-lbl">Past due</div>
          <div className="admin-stat-sub">In 7-day grace</div>
        </div>
      </div>

      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: stats are illustrative. Everything on these pages goes
          live against real data once Supabase is connected.
        </div>
      )}

      <div className="admin-nav-cards">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div className="stat-icon purple">
                  <Icon size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                    {s.desc}
                  </div>
                </div>
                <ChevronRightIcon size={12} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
