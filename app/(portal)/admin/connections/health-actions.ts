"use server";

import { revalidatePath } from "next/cache";
import { getAdminAccess } from "@/lib/auth-helpers";
import { runHealthCycle } from "@/lib/health";

export interface RunHealthResult {
  ok: boolean;
  message: string;
}

/** Run the full health-check cycle on demand from Admin → Connections —
    same probes and same transition alerts as the 6-hour cron, so a fix
    can be verified immediately instead of waiting for the next run.

    Returns a result rather than void. The old signature returned nothing
    and bailed silently for a non-super admin, so every failure mode —
    wrong role, a throw mid-cycle, a probe hanging — looked identical to
    the button doing nothing at all (Matt, 2026-08-12). */
export async function runHealthNowAction(): Promise<RunHealthResult> {
  const access = await getAdminAccess();
  if (access?.role !== "super") {
    return { ok: false, message: "Super Admin only — nothing was run." };
  }
  try {
    const { report, failures, recoveries, alerted } = await runHealthCycle();
    revalidatePath("/admin/connections");
    const failing = report.checks.filter((c) => !c.skipped && !c.ok);
    const parts = [`${report.checks.length} checks run`];
    parts.push(
      failing.length === 0
        ? "all passing"
        : `failing: ${failing.map((c) => c.name).join(", ")}`,
    );
    if (failures.length > 0 || recoveries.length > 0) {
      parts.push(alerted ? "alert emailed" : "alert email could not be sent");
    }
    return { ok: failing.length === 0, message: parts.join(" — ") };
  } catch (e) {
    // A thrown cycle used to surface as nothing at all. Say what broke.
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "The run failed.").slice(
        0,
        200,
      ),
    };
  }
}
