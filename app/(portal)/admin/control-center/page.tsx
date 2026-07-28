import { redirect } from "next/navigation";
import { ControlCenter } from "@/components/admin/ControlCenter";
import { getAdminAccess } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAccessMatrix } from "@/lib/tiers";

export const dynamic = "force-dynamic";

/*
 * The Control Center — what exists, who reaches it, and what the public can
 * buy. Super Admin only: this is the one screen where a wrong click changes
 * what every paying member sees.
 */
export default async function ControlCenterPage() {
  if (isSupabaseConfigured()) {
    const access = await getAdminAccess();
    if (access?.role !== "super") redirect("/admin");
  }

  const matrix = await getAccessMatrix();

  // How many live members sit on each tier, so a Go Live or a restriction
  // shows its blast radius before it's pressed.
  const memberCounts: Record<string, number> = {};
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createServiceClient()
      .from("memberships")
      .select("tier")
      .in("status", ["active", "past_due", "canceled"]);
    for (const row of data ?? []) {
      const tier = String((row as { tier: string }).tier);
      memberCounts[tier] = (memberCounts[tier] ?? 0) + 1;
    }
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Control Center</h2>
          <p>
            Launch switches, tier access and member types. Changes here take
            effect immediately for every member.
          </p>
        </div>
      </div>
      <ControlCenter matrix={matrix} memberCounts={memberCounts} />
    </div>
  );
}
