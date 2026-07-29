import { redirect } from "next/navigation";
import {
  ErrorsManager,
  type ErrorReportRow,
} from "@/components/admin/ErrorsManager";
import { getAdminAccess } from "@/lib/auth-helpers";
import { loadErrorReports } from "@/lib/error-reports";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform Errors | Momentum+" };

/*
 * Platform Errors — the crash reports the error boundaries file, who each
 * one actually affected (migration 0061), and a one-click "we're on it"
 * note to exactly those members (Matt, 2026-07-29). Super Admin only: the
 * page can email members and reads error internals.
 */
export default async function AdminErrorsPage() {
  let reports: ErrorReportRow[] = [];
  if (isSupabaseConfigured()) {
    const access = await getAdminAccess();
    if (access?.role !== "super") redirect("/admin");
    reports = await loadErrorReports();
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Platform Errors</h2>
          <p>
            Crash screens members have hit, who was affected, and a fast
            &quot;we&apos;re on it&quot; note to exactly those members.
          </p>
        </div>
      </div>
      <ErrorsManager reports={reports} />
    </div>
  );
}
