import { StreamChat } from "stream-chat";
import { readCronHealth } from "@/lib/cron-health";
import {
  cronCheck,
  diffReports,
  lateCrons,
  type CronExpectations,
  type HealthCheck,
  type HealthReport,
} from "@/lib/health-shared";
import { isMuxConfigured } from "@/lib/mux";
import { sendEmailViaGhl } from "@/lib/notifications";
import {
  getAnthropicApiKey,
  getGhlCreds,
  getZoomCreds,
} from "@/lib/service-config";
import {
  getSheetsAccessToken,
  isSheetsConfigured,
  readSheetRange,
} from "@/lib/sheets";
import { isStreamConfigured } from "@/lib/stream";
import { getStripeSettings, stripeRequest } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getZoomAccessToken } from "@/lib/zoom";

/*
 * Recurring health checks (Matt, 2026-07-31): every 6 hours a cron probes
 * each integration FOR REAL — mints a Zoom token, calls Stripe, reads the
 * sheet — because "the env var is set" says nothing about a revoked key or
 * an expired service account. The report lands in app_settings
 * ("health_report") and renders on Admin → Connections; alerts are
 * transition-based (see diffReports), so a broken service emails the Super
 * Admins once when it breaks and once when it recovers.
 */

const REPORT_KEY = "health_report";
const PROBE_TIMEOUT_MS = 8_000;

/** Scheduled interval per cron, in minutes — keep in step with vercel.json. */
const CRON_EXPECTATIONS: CronExpectations = {
  attendance: 30,
  "tsls-import": 30,
  reconcile: 1440,
  dunning: 1440,
  reminders: 5,
  summaries: 60,
  "scheduled-posts": 5,
  "monthly-report": 44640,
  "gift-activate": 1440,
  health: 360,
};

function dbReady(): boolean {
  return isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function skippedCheck(name: string, note: string): HealthCheck {
  return { name, ok: true, skipped: true, note };
}

/** Run one probe with a hard timeout; any throw becomes a failed check. */
async function guard(
  name: string,
  fn: () => Promise<HealthCheck>,
): Promise<HealthCheck> {
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out after ${PROBE_TIMEOUT_MS / 1000}s`)),
          PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    return {
      name,
      ok: false,
      note: (e instanceof Error ? e.message : "probe failed").slice(0, 200),
    };
  }
}

const abortSoon = () => AbortSignal.timeout(PROBE_TIMEOUT_MS);

function tslsBase(): string {
  return (process.env.NEXT_PUBLIC_TSLS_EVENT_URL ?? "").replace(/\/$/, "");
}

export async function runHealthChecks(): Promise<HealthReport> {
  const checks = await Promise.all([
    guard("Database", async () => {
      if (!dbReady()) {
        return skippedCheck("Database", "Supabase env not set (preview mode)");
      }
      const { error } = await createServiceClient()
        .from("app_settings")
        .select("key")
        .limit(1);
      if (error) throw new Error(error.message);
      return { name: "Database", ok: true, note: "query ok" };
    }),

    guard("Stripe", async () => {
      const s = await getStripeSettings();
      if (!s?.secretKey) {
        return skippedCheck("Stripe", "connect it in Admin → Connections");
      }
      await stripeRequest(s.secretKey, "GET", "/account");
      return {
        name: "Stripe",
        ok: true,
        note: `key valid (${s.livemode ? "live" : "test"} mode)`,
      };
    }),

    guard("Zoom", async () => {
      const c = await getZoomCreds();
      if (!(c.accountId && c.clientId && c.clientSecret)) {
        return skippedCheck("Zoom", "connect it in Admin → Connections");
      }
      await getZoomAccessToken();
      return { name: "Zoom", ok: true, note: "token minted" };
    }),

    guard("Anthropic", async () => {
      const key = await getAnthropicApiKey();
      if (!key) {
        return skippedCheck("Anthropic", "connect it in Admin → Connections");
      }
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        cache: "no-store",
        signal: abortSoon(),
      });
      if (!res.ok) throw new Error(`Anthropic returned ${res.status}`);
      return { name: "Anthropic", ok: true, note: "key valid" };
    }),

    guard("Go High Level", async () => {
      const creds = await getGhlCreds();
      if (!creds.apiKey || !creds.locationId) {
        return skippedCheck("Go High Level", "connect it in Admin → Connections");
      }
      const headers = {
        Authorization: `Bearer ${creds.apiKey}`,
        Version: "2021-07-28",
      };
      // Same fallback as the connect wizard: some tokens lack the
      // Locations scope yet can read contacts fine.
      let res = await fetch(
        `https://services.leadconnectorhq.com/locations/${encodeURIComponent(creds.locationId)}`,
        { headers, cache: "no-store", signal: abortSoon() },
      );
      if (!res.ok) {
        res = await fetch(
          `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(creds.locationId)}&limit=1`,
          { headers, cache: "no-store", signal: abortSoon() },
        );
      }
      if (!res.ok) throw new Error(`GHL returned ${res.status}`);
      return { name: "Go High Level", ok: true, note: "key valid" };
    }),

    guard("Stream Chat", async () => {
      if (!isStreamConfigured()) {
        return skippedCheck("Stream Chat", "Stream env keys not set");
      }
      const client = StreamChat.getInstance(
        process.env.NEXT_PUBLIC_STREAM_API_KEY as string,
        process.env.STREAM_API_SECRET as string,
      );
      await client.getAppSettings();
      return { name: "Stream Chat", ok: true, note: "API reachable" };
    }),

    guard("Mux video", async () => {
      if (!isMuxConfigured()) {
        return skippedCheck("Mux video", "Mux env keys not set");
      }
      const basic = Buffer.from(
        `${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`,
      ).toString("base64");
      const res = await fetch("https://api.mux.com/video/v1/assets?limit=1", {
        headers: { Authorization: `Basic ${basic}` },
        cache: "no-store",
        signal: abortSoon(),
      });
      if (!res.ok) throw new Error(`Mux returned ${res.status}`);
      return { name: "Mux video", ok: true, note: "key valid" };
    }),

    guard("Registration sheet", async () => {
      if (!isSheetsConfigured()) {
        return skippedCheck("Registration sheet", "Google Sheets env not set");
      }
      const token = await getSheetsAccessToken();
      await readSheetRange(token, "A1:A1");
      return {
        name: "Registration sheet",
        ok: true,
        note: "sheet readable",
      };
    }),

    guard("TSLS app", async () => {
      const base = tslsBase();
      if (!base) {
        return skippedCheck(
          "TSLS app",
          "NEXT_PUBLIC_TSLS_EVENT_URL unset (off-season)",
        );
      }
      const res = await fetch(`${base}/api/health`, {
        cache: "no-store",
        signal: abortSoon(),
      });
      // 404 = the TSLS deployment predates its health endpoint, not an
      // outage (a down Vercel app doesn't answer 404).
      if (res.status === 404) {
        return skippedCheck(
          "TSLS app",
          "reachable, but its health endpoint isn't deployed yet",
        );
      }
      if (!res.ok) throw new Error(`TSLS /api/health returned ${res.status}`);
      return { name: "TSLS app", ok: true, note: "up and answering" };
    }),

    guard("TSLS bridge key", async () => {
      const base = tslsBase();
      const key = process.env.TSLS_SSO_KEY;
      if (!base || !key) {
        return skippedCheck(
          "TSLS bridge key",
          "TSLS_SSO_KEY + NEXT_PUBLIC_TSLS_EVENT_URL not both set",
        );
      }
      const res = await fetch(`${base}/api/bridge/ping`, {
        headers: { "x-api-key": key },
        cache: "no-store",
        signal: abortSoon(),
      });
      if (res.status === 404) {
        return skippedCheck(
          "TSLS bridge key",
          "TSLS hasn't deployed its ping endpoint yet",
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "key rejected — TSLS_SSO_KEY must equal TSLS's TSLS_SSO_SECRET",
        );
      }
      if (!res.ok) throw new Error(`TSLS ping returned ${res.status}`);
      return { name: "TSLS bridge key", ok: true, note: "keys match" };
    }),

    guard("Scheduled jobs", async () => {
      const runs = await readCronHealth();
      return cronCheck(
        lateCrons(CRON_EXPECTATIONS, runs, Date.now()),
        Object.keys(CRON_EXPECTATIONS).length,
      );
    }),

    guard("Member error reports", async () => {
      if (!dbReady()) {
        return skippedCheck("Member error reports", "no database");
      }
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { count, error } = await createServiceClient()
        .from("error_reports")
        .select("hash", { count: "exact", head: true })
        .gte("last_seen", cutoff);
      if (error) throw new Error(error.message);
      // Informational: crash alerting has its own pipeline (/api/errors);
      // this just keeps the count visible on the health panel.
      return {
        name: "Member error reports",
        ok: true,
        note: count
          ? `${count} distinct error${count === 1 ? "" : "s"} hit in the last 24h — see Admin → Platform Errors`
          : "none in the last 24h",
      };
    }),
  ]);

  return { at: new Date().toISOString(), checks };
}

export async function readHealthReport(): Promise<HealthReport | null> {
  if (!dbReady()) return null;
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", REPORT_KEY)
      .maybeSingle();
    return (data?.value as HealthReport | undefined) ?? null;
  } catch {
    return null;
  }
}

async function saveHealthReport(report: HealthReport): Promise<void> {
  if (!dbReady()) return;
  try {
    await createServiceClient()
      .from("app_settings")
      .upsert(
        { key: REPORT_KEY, value: report, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
  } catch {
    /* the report is a convenience — never fail the run over storage */
  }
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendHealthAlert(
  failures: HealthCheck[],
  recoveries: HealthCheck[],
): Promise<boolean> {
  if (!dbReady()) return false;
  const admin = createServiceClient();
  const { data: supers } = await admin
    .from("profiles")
    .select("id, email")
    .eq("admin_role", "super");
  if (!supers?.length) return false;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
  const subject =
    failures.length > 0
      ? `[Momentum+ ALERT] ${failures.length} health check${failures.length === 1 ? "" : "s"} failing`
      : "[Momentum+] All health checks recovered";
  const line = (c: HealthCheck) =>
    `<p style="margin:0 0 6px;"><strong>${esc(c.name)}:</strong> ${esc(c.note)}</p>`;
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${failures.length ? "#c0392b" : "#3d7a4f"};font-weight:bold;">Health check</p>
      ${
        failures.length
          ? `<p style="margin:0 0 12px;line-height:1.6;">The 6-hour health check just found a problem:</p>${failures.map(line).join("")}`
          : ""
      }
      ${
        recoveries.length
          ? `<p style="margin:${failures.length ? "14px" : "0"} 0 12px;line-height:1.6;">Back to normal:</p>${recoveries.map(line).join("")}`
          : ""
      }
      <p style="margin:14px 0 0;">
        <a href="${siteUrl}/admin/connections" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;padding:9px 16px;border-radius:4px;text-decoration:none;">Open Connections &amp; run the checks again</a>
      </p>
      <p style="margin:12px 0 0;font-size:11.5px;color:#9ca3af;">
        You only get this email when something CHANGES — a service that
        stays down won't email again until it recovers.
      </p>
    </div>
  </div>`;

  let sent = false;
  for (const s of supers) {
    if (!s.email) continue;
    const res = await sendEmailViaGhl({
      email: s.email as string,
      subject,
      html,
    });
    if (res.sent) sent = true;
  }

  // Bell notice too — it still lands when GHL itself is the thing that broke.
  try {
    await admin.from("notifications").insert(
      supers.map((s) => ({
        profile_id: s.id,
        kind: "platform",
        title:
          failures.length > 0
            ? `Health check: ${failures.map((f) => f.name).join(", ")} failing`
            : "Health check: everything recovered",
        body: (failures[0] ?? recoveries[0])?.note?.slice(0, 140) ?? "",
        link: "/admin/connections",
      })),
    );
  } catch {
    /* best-effort */
  }
  return sent;
}

/**
 * One full cycle: probe, journal, and alert on transitions. Shared by the
 * 6-hour cron and the Run-now button on Admin → Connections.
 */
export async function runHealthCycle(): Promise<{
  report: HealthReport;
  failures: HealthCheck[];
  recoveries: HealthCheck[];
  alerted: boolean;
}> {
  const previous = await readHealthReport();
  const report = await runHealthChecks();
  await saveHealthReport(report);
  const { failures, recoveries } = diffReports(previous, report);
  let alerted = false;
  if (failures.length > 0 || recoveries.length > 0) {
    alerted = await sendHealthAlert(failures, recoveries);
  }
  return { report, failures, recoveries, alerted };
}
