import { redirect } from "next/navigation";
import {
  ErrorsManager,
  type ErrorReportRow,
} from "@/components/admin/ErrorsManager";
import { getAdminAccess } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
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

    const admin = createServiceClient();
    const { data } = await admin
      .from("error_reports")
      .select(
        "hash, message, path, count, first_seen, last_seen, users_notified_at",
      )
      .order("last_seen", { ascending: false })
      .limit(100);
    const rows = data ?? [];

    // Affected-member counts per error, one query for the whole page.
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const { data: hits } = await admin
        .from("error_report_hits")
        .select("hash")
        .in(
          "hash",
          rows.map((r) => String(r.hash)),
        );
      for (const h of hits ?? []) {
        const key = String(h.hash);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    reports = rows.map((r) => ({
      hash: String(r.hash),
      message: String(r.message ?? ""),
      path: String(r.path ?? ""),
      count: Number(r.count ?? 0),
      affected: counts.get(String(r.hash)) ?? 0,
      firstSeen: String(r.first_seen),
      lastSeen: String(r.last_seen),
      usersNotifiedAt: (r.users_notified_at as string | null) ?? null,
    }));
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
