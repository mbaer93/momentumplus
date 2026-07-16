import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { listAdminAudit } from "@/lib/admin-audit";
import { getAdminAccess } from "@/lib/auth-helpers";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin Audit Log | Momentum+" };

/*
 * Super-Admin-only record of sensitive admin actions — login links minted,
 * members deleted, admin access changed. An accountable trail for actions
 * that can reach member accounts or private data.
 */
export default async function AdminAuditPage() {
  const access = await getAdminAccess();
  if (isSupabaseConfigured() && access?.role !== "super") {
    redirect("/admin");
  }

  const rows = await listAdminAudit();

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Admin Audit Log</h2>
          <p>Sensitive admin actions — who did what, and to whom</p>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ whiteSpace: "nowrap" }}>When (ET)</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Member</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.at}-${i}`}>
                <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                  {new Date(r.at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "America/New_York",
                  })}
                </td>
                <td style={{ fontSize: 13 }}>{r.actorEmail}</td>
                <td>
                  <span className="admin-status draft">{r.actionLabel}</span>
                </td>
                <td style={{ fontSize: 13 }}>{r.targetEmail}</td>
                <td style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                  {r.detail || "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--mid-gray)", fontSize: 13 }}>
                  No admin actions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
