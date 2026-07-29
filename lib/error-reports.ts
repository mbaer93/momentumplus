import type { ErrorReportRow } from "@/components/admin/ErrorsManager";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Error-report loader shared by Admin → Platform Errors and the /rescue
 * break-glass console. Service-role reads only — deliberately independent
 * of the member pipeline (sessions, ads, tiers), so it keeps working when
 * those are exactly what's broken.
 */
export async function loadErrorReports(): Promise<ErrorReportRow[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("error_reports")
    .select(
      "hash, message, path, count, first_seen, last_seen, users_notified_at",
    )
    .order("last_seen", { ascending: false })
    .limit(100);
  if (error) return [];
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

  return rows.map((r) => ({
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
