import { notFound, redirect } from "next/navigation";
import { ErrorsManager } from "@/components/admin/ErrorsManager";
import { loadErrorReports } from "@/lib/error-reports";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rescue Console | Momentum+" };

/*
 * Break-glass console (Matt, 2026-07-29: "Is there a way to have super
 * admin outside of the regular system, so that I can still access this
 * and send the email?").
 *
 * The admin panel lives inside the portal layout, so the exact failures
 * this page exists for (a crash in the layout's session/ads/tier reads)
 * take the admin panel down with them. This route sits OUTSIDE the
 * (portal) group and touches almost nothing: auth check, one service-role
 * profiles read, and the error-report loader. No member pipeline, no
 * sessions, no ads, no tier matrix. If Supabase itself is up, this page
 * is up.
 *
 * Non-supers get a plain 404 — the route's existence is not advertised.
 */
export default async function RescuePage() {
  if (!isSupabaseConfigured()) notFound();
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { data: profile } = await createServiceClient()
    .from("profiles")
    .select("admin_role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.admin_role !== "super") notFound();

  /*
   * The second factor applies here too (2026-08-19). This console is
   * Super-Admin-only and outside the portal layout by design — which is
   * exactly what would make it the way around MFA if it were exempt. A
   * fence with a gap beside it is a decoration.
   *
   * Break-glass for a genuinely lost authenticator is deleting the factor
   * row in Supabase directly. That needs database access, which is a
   * strictly higher bar than knowing the password — which is the point.
   */
  const { mfaStatus } = await import("@/lib/mfa");
  if ((await mfaStatus()).mustVerify) redirect("/verify?redirect=/rescue");

  const reports = await loadErrorReports();

  return (
    <div className="admin-pad" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="section-header">
        <div>
          <h2>Rescue Console</h2>
          <p>
            The break-glass view of Platform Errors — this page works even
            when the member portal (and the normal admin panel) is down.
            Notify affected members from here, then head to{" "}
            <a href="/admin/errors" style={{ color: "var(--gold-text)" }}>
              the full admin panel
            </a>{" "}
            once things recover.
          </p>
        </div>
      </div>
      <ErrorsManager reports={reports} />
    </div>
  );
}
