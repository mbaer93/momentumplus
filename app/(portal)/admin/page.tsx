import Link from "next/link";
import {
  AdminIcon,
  BriefcaseIcon,
  ChevronRightIcon,
  CommunityIcon,
  EducationIcon,
  LibraryIcon,
  ResourcesIcon,
  SessionsIcon,
  SettingsIcon,
  SpeakersIcon,
  SponsorsIcon,
} from "@/components/icons";
import { canAccessArea, type AdminArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listSessions } from "@/lib/sessions/queries";

export const dynamic = "force-dynamic";

const SECTIONS: {
  href: string;
  icon: typeof SessionsIcon;
  title: string;
  desc: string;
  area: AdminArea;
}[] = [
  {
    href: "/admin/sessions",
    icon: SessionsIcon,
    title: "Sessions",
    desc: "Create, publish (creates the Zoom meeting), and manage sessions.",
    area: "sessions",
  },
  {
    href: "/admin/members",
    icon: SpeakersIcon,
    title: "Members",
    desc: "Memberships, grants, bulk import, and (Super Admin) admin access.",
    area: "members",
  },
  {
    href: "/admin/activity",
    icon: AdminIcon,
    title: "Activity Log",
    desc: "Invites, first logins, enrollments, learning, and engagement — by category.",
    area: "members",
  },
  {
    href: "/admin/announcements",
    icon: CommunityIcon,
    title: "Announcements",
    desc: "Compose and send to members by tier and channel.",
    area: "announcements",
  },
  {
    href: "/admin/sponsors",
    icon: SponsorsIcon,
    title: "Sponsors",
    desc: "Partners, rail placement, logos, sidebar ad, impressions and clicks.",
    area: "sponsors",
  },
  {
    href: "/admin/videos",
    icon: LibraryIcon,
    title: "Library",
    desc: "Recordings in the Session Library — add, edit, publish.",
    area: "content",
  },
  {
    href: "/admin/speakers",
    icon: SpeakersIcon,
    title: "Speakers",
    desc: "Speaker directory profiles, topics, and bios.",
    area: "content",
  },
  {
    href: "/admin/resources",
    icon: ResourcesIcon,
    title: "Resources",
    desc: "Member tools, guides, and partner materials.",
    area: "content",
  },
  {
    href: "/admin/services",
    icon: BriefcaseIcon,
    title: "Additional Services",
    desc: "SLC service offerings with sign-up links.",
    area: "content",
  },
  {
    href: "/admin/education",
    icon: EducationIcon,
    title: "Education",
    desc: "Courses and learning tracks built from the library.",
    area: "content",
  },
  {
    href: "/admin/analytics",
    icon: SessionsIcon,
    title: "Analytics",
    desc: "Who enrolled and attended, sponsor views and clicks, top content.",
    area: "sessions",
  },
];

export default async function AdminPage() {
  // Standard admins only see cards for areas the Super Admin left enabled;
  // requireAdmin(area) re-enforces this on every mutation regardless.
  const access = await getAdminAccess();
  const sections = SECTIONS.filter((s) => canAccessArea(access, s.area));
  // Billing + Connections are Super Admin territory — they hold account keys.
  if (access?.role === "super") {
    sections.push(
      {
        href: "/admin/billing",
        icon: SponsorsIcon,
        title: "Billing — Stripe",
        desc: "Connect Stripe, set plan prices, and go live with self-serve memberships.",
        area: "members",
      },
      {
        href: "/admin/connections",
        icon: SettingsIcon,
        title: "Connections",
        desc: "Every integration (Stripe, Zoom, chat, video, AI) — status and setup.",
        area: "members",
      },
      {
        href: "/admin/audit",
        icon: AdminIcon,
        title: "Audit Log",
        desc: "Sensitive admin actions — login links minted, members deleted, admin access changed.",
        area: "members",
      },
    );
  }

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
        {sections.map((s) => {
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
