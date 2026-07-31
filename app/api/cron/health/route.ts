import { NextResponse, type NextRequest } from "next/server";
import { recordCronRun } from "@/lib/cron-health";
import { bearerAuthorized } from "@/lib/db-utils";
import { runHealthCycle } from "@/lib/health";

/*
 * The 6-hour health check (see lib/health.ts). Probes every integration,
 * journals the report for Admin → Connections, and emails/bells the Super
 * Admins when something breaks or recovers.
 */

export const dynamic = "force-dynamic";
// Every probe has an 8s cap and they run concurrently, but leave headroom
// for the alert emails.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { report, failures, recoveries, alerted } = await runHealthCycle();
  const failing = report.checks.filter((c) => !c.skipped && !c.ok);
  await recordCronRun(
    "health",
    failing.length === 0
      ? `all ${report.checks.length} checks passing`
      : `failing: ${failing.map((c) => c.name).join(", ")}${alerted ? " (alert sent)" : ""}`,
  );
  return NextResponse.json({
    ok: true,
    checks: report.checks.length,
    failing: failing.map((c) => c.name),
    newFailures: failures.map((c) => c.name),
    recoveries: recoveries.map((c) => c.name),
    alerted,
  });
}
