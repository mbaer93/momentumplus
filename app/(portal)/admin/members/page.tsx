import Link from "next/link";
import {
  MembersManager,
  type AdminMemberRow,
} from "@/components/admin/MembersManager";
import { BulkAddMembers } from "@/components/admin/BulkAddMembers";
import { ArrowLeftIcon } from "@/components/icons";
import { tierLabel } from "@/lib/access";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tier } from "@/lib/types";

export const dynamic = "force-dynamic";

const PREVIEW_MEMBERS: AdminMemberRow[] = [
  {
    membershipId: "m1",
    name: "Sarah Johnson",
    email: "sarah@example.com",
    tier: "sub_annual",
    tierLabel: "Annual Member",
    status: "active",
    expiresLabel: "Mar 14, 2027",
    source: "ghl",
  },
  {
    membershipId: "m2",
    name: "Marcus Chen",
    email: "marcus@example.com",
    tier: "tsls_vip",
    tierLabel: "VIP Member",
    status: "active",
    expiresLabel: "Oct 2, 2026",
    source: "tsls_import",
  },
  {
    membershipId: "m3",
    name: "Priya Nair",
    email: "priya@example.com",
    tier: "sub_monthly",
    tierLabel: "Monthly Member",
    status: "past_due",
    expiresLabel: "Jul 20, 2026",
    source: "ghl",
  },
];

export default async function AdminMembersPage() {
  let members = PREVIEW_MEMBERS;

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("memberships")
      .select(
        "id, tier, status, access_expires_at, source, profiles ( full_name, email )",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data) {
      members = data.map((row) => {
        const p = (
          row as unknown as {
            profiles: { full_name: string; email: string } | null;
          }
        ).profiles;
        return {
          membershipId: row.id,
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
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: showing sample members. GHL remains the source of truth
          for paid memberships — manual grants here are for speakers, admins,
          and comps (source=admin).
        </div>
      )}
      <BulkAddMembers />
      <MembersManager members={members} />
    </div>
  );
}
