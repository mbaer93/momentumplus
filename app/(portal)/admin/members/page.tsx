import Link from "next/link";
import {
  MembersManager,
  type AdminMemberRow,
} from "@/components/admin/MembersManager";
import { BulkAddMembers } from "@/components/admin/BulkAddMembers";
import { ArrowLeftIcon } from "@/components/icons";
import { tierLabel } from "@/lib/access";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { redirect } from "next/navigation";
import type { Tier } from "@/lib/types";

export const dynamic = "force-dynamic";

const PREVIEW_PROFILE_DEFAULTS = {
  profileTitle: "",
  profileCompany: "",
  profilePhone: "",
  adminRole: null,
  adminPerms: {},
} as const;

const PREVIEW_MEMBERS: AdminMemberRow[] = [
  {
    membershipId: "m1",
    profileId: "p1",
    name: "Sarah Johnson",
    email: "sarah@example.com",
    tier: "sub_annual",
    tierLabel: "Annual Member",
    status: "active",
    expiresLabel: "Mar 14, 2027",
    source: "ghl",
    invitedLabel: "Invited Jun 2, 2026",
    firstLoginLabel: "Jun 3, 2026",
    lastLoginLabel: "Jul 10, 2026",
    neverLoggedIn: false,
    ...PREVIEW_PROFILE_DEFAULTS,
  },
  {
    membershipId: "m2",
    profileId: "p2",
    name: "Marcus Chen",
    email: "marcus@example.com",
    tier: "tsls_vip",
    tierLabel: "VIP Member",
    status: "active",
    expiresLabel: "Oct 2, 2026",
    source: "tsls_import",
    invitedLabel: "Invited Jul 12, 2026",
    firstLoginLabel: null,
    lastLoginLabel: null,
    neverLoggedIn: true,
    ...PREVIEW_PROFILE_DEFAULTS,
  },
  {
    membershipId: "m3",
    profileId: "p3",
    name: "Priya Nair",
    email: "priya@example.com",
    tier: "sub_monthly",
    tierLabel: "Monthly Member",
    status: "past_due",
    expiresLabel: "Jul 20, 2026",
    source: "ghl",
    invitedLabel: "Joined May 18, 2026",
    firstLoginLabel: "May 18, 2026",
    lastLoginLabel: "Jul 14, 2026",
    neverLoggedIn: false,
    ...PREVIEW_PROFILE_DEFAULTS,
  },
];

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface AuthActivity {
  invitedAt: string | null;
  confirmedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

/**
 * Pull invite/login timestamps from the Supabase auth layer, keyed by user
 * id (= profile id). This is what tells us whether an "active" membership
 * belongs to someone who has actually signed in.
 */
async function fetchAuthActivity(
  profileIds: string[],
): Promise<Map<string, AuthActivity>> {
  const admin = createServiceClient();
  const byId = new Map<string, AuthActivity>();
  if (profileIds.length === 0) return byId;

  // One RPC scoped to exactly the displayed profiles (migration 0024) —
  // this page used to walk the ENTIRE auth user list, up to 20 sequential
  // Auth-admin API calls per view.
  const { data: rpcRows, error: rpcError } = await admin.rpc("auth_activity", {
    ids: profileIds,
  });
  if (!rpcError && rpcRows) {
    for (const u of rpcRows as {
      id: string;
      invited_at: string | null;
      confirmed_at: string | null;
      last_sign_in_at: string | null;
      created_at: string | null;
    }[]) {
      byId.set(u.id, {
        invitedAt: u.invited_at ?? null,
        confirmedAt: u.confirmed_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at ?? null,
      });
    }
    return byId;
  }

  // Fallback until the migration is applied: page the auth list.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      byId.set(u.id, {
        invitedAt: u.invited_at ?? null,
        confirmedAt: u.email_confirmed_at ?? u.confirmed_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at ?? null,
      });
    }
    if (data.users.length < 1000) break;
  }
  return byId;
}

export default async function AdminMembersPage() {
  // Member PII (email, phone, login history) is behind the "members" area,
  // enforced HERE on the read — the admin layout only checks "is an admin",
  // so a standard admin without the members area could otherwise open this
  // URL directly and read everyone's contact details.
  const access = await getAdminAccess();
  if (isSupabaseConfigured() && !canAccessArea(access, "members")) {
    redirect("/admin");
  }

  let members = PREVIEW_MEMBERS;

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    // Memberships first, then auth activity for exactly those profiles.
    const { data } = await admin
      .from("memberships")
      .select(
        "id, profile_id, tier, status, access_expires_at, source, profiles ( full_name, email, title, company, phone, admin_role, admin_perms )",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    const authActivity = await fetchAuthActivity(
      Array.from(new Set((data ?? []).map((r) => r.profile_id as string))),
    );
    if (data) {
      members = data.map((row) => {
        const p = (
          row as unknown as {
            profiles: {
              full_name: string;
              email: string;
              title: string | null;
              company: string | null;
              phone: string | null;
              admin_role: "super" | "standard" | null;
              admin_perms: Record<string, boolean> | null;
            } | null;
          }
        ).profiles;
        const activity = authActivity.get(row.profile_id);
        const invitedDate = shortDate(activity?.invitedAt);
        const joinedDate = shortDate(activity?.createdAt);
        const neverLoggedIn = Boolean(
          activity && !activity.lastSignInAt && !activity.confirmedAt,
        );
        return {
          membershipId: row.id,
          profileId: row.profile_id,
          name: p?.full_name || "—",
          email: p?.email ?? "",
          tier: row.tier,
          tierLabel: tierLabel(row.tier as Tier),
          status: row.status,
          expiresLabel: row.access_expires_at
            ? new Date(row.access_expires_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "Ongoing",
          source: row.source,
          invitedLabel: invitedDate
            ? `Invited ${invitedDate}`
            : joinedDate
              ? `Joined ${joinedDate}`
              : null,
          firstLoginLabel: shortDate(activity?.confirmedAt),
          lastLoginLabel: shortDate(activity?.lastSignInAt),
          neverLoggedIn,
          profileTitle: p?.title ?? "",
          profileCompany: p?.company ?? "",
          profilePhone: p?.phone ?? "",
          adminRole: p?.admin_role ?? null,
          adminPerms: p?.admin_perms ?? {},
        } satisfies AdminMemberRow;
      });
    }
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Members</h2>
          <p>Memberships, access, and manual grants</p>
        </div>
        <Link href="/admin/activity" className="btn-primary">
          View Activity Log
        </Link>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: showing sample members. GHL remains the source of truth
          for paid memberships — manual grants here are for speakers, admins,
          and comps (source=admin).
        </div>
      )}
      <BulkAddMembers />
      <MembersManager
        members={members}
        viewerIsSuper={access?.role === "super"}
      />
    </div>
  );
}
