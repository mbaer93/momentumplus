"use server";

import { revalidatePath } from "next/cache";
import { getAdminAccess } from "@/lib/auth-helpers";
import { runHealthCycle } from "@/lib/health";

/** Run the full health-check cycle on demand from Admin → Connections —
    same probes and same transition alerts as the 6-hour cron, so a fix
    can be verified immediately instead of waiting for the next run. */
export async function runHealthNowAction(): Promise<void> {
  const access = await getAdminAccess();
  if (access?.role !== "super") return;
  await runHealthCycle();
  revalidatePath("/admin/connections");
}
