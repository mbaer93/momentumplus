import { redirect } from "next/navigation";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { AdsManager } from "@/components/admin/AdsManager";
import { listAds, listPlacements } from "@/lib/ads";
import { requireAdmin } from "@/lib/auth-helpers";
import { listSponsors } from "@/lib/directory-queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ad Manager | Momentum+" };

/*
 * Ad Manager — every banner and notice slot in the portal, what's in each,
 * and in what order. Before this, a slot's occupants were decided in code
 * (the rail took the top three sponsor tiers, the in-body banner took
 * Momentum+ Sponsor and Title), which left no way to run a house notice or
 * to reorder two ads sharing a slot (Matt, 2026-07-28).
 */
export default async function AdminAdsPage() {
  if (isSupabaseConfigured()) {
    const auth = await requireAdmin("sponsors");
    if (!auth.ok) redirect("/admin");
  }

  const [placements, sponsors] = await Promise.all([
    listPlacements(),
    listSponsors(),
  ]);

  // The manager wants everything, including scheduled and switched-off rows;
  // listAds() reads through RLS, which hides those from members but not from
  // an admin. Reading via the service role keeps that true even if the
  // policy is ever tightened.
  let ads = await listAds();
  let needsMigration = false;
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { error } = await createServiceClient()
      .from("ads")
      .select("id", { head: true, count: "exact" });
    needsMigration = Boolean(error);
    if (needsMigration) ads = [];
  }

  return (
    <div className="admin-pad">
      <AdminBackLink />
      <div className="page-header">
        <h1>Ad Manager</h1>
        <p>
          Banners, notices and where they run. Sponsor-linked creatives keep
          reporting their views and clicks in Analytics.
        </p>
      </div>
      <AdsManager
        placements={placements}
        ads={ads}
        sponsors={sponsors.map((s) => ({ id: s.id, name: s.name }))}
        needsMigration={needsMigration}
      />
    </div>
  );
}
