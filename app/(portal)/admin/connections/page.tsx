import {
  BillingSetup,
  type BillingStatus,
} from "@/components/admin/BillingSetup";
import {
  AnthropicWizard,
  GhlWizard,
  SmtpWizard,
  ZoomWizard,
} from "@/components/admin/ConnectWizards";
import { getAdminAccess } from "@/lib/auth-helpers";
import { readCronHealth } from "@/lib/cron-health";
import { readHealthReport } from "@/lib/health";
import { runHealthNowAction } from "./health-actions";
import { isMuxConfigured } from "@/lib/mux";
import { pushConfigured } from "@/lib/push";
import {
  getZoomCreds,
  isAnthropicReady,
  isGhlReady,
  isSmtpMarkedDone,
  isZoomReady,
  isZoomSdkReady,
} from "@/lib/service-config";
import { isSheetsConfigured } from "@/lib/sheets";
import { isStreamConfigured } from "@/lib/stream";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Connections: one place to see and set up every outside service. Stripe,
 * Zoom, Anthropic, GHL, and email get in-app wizards (credentials validated
 * and stored server-side — no Vercel). The rest show exact instructions.
 */

function StatusChip({
  connected,
  optional,
}: {
  connected: boolean;
  optional?: boolean;
}) {
  return (
    <span className={`admin-status ${connected ? "completed" : "draft"}`}>
      {connected ? "Connected" : optional ? "Optional" : "Not connected"}
    </span>
  );
}

function ConnectionCard({
  title,
  powers,
  connected,
  optional,
  children,
  defaultOpen,
}: {
  title: string;
  powers: string;
  connected: boolean;
  optional?: boolean;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="admin-form"
      style={{ maxWidth: "none", marginBottom: 14 }}
      open={defaultOpen}
    >
      <summary style={{ cursor: "pointer", listStyle: "none" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
            <div style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 2 }}>
              {powers}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusChip connected={connected} optional={optional} />
            <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
              Click to {connected ? "review" : "set up"}
            </span>
          </div>
        </div>
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}

export default async function AdminConnectionsPage() {
  const access = await getAdminAccess();
  const isSuper = access?.role === "super";

  const [
    stripe,
    zoomOk,
    zoomSdkOk,
    zoomCreds,
    anthropicOk,
    ghlOk,
    smtpDone,
    cronHealth,
    healthReport,
  ] = await Promise.all([
    getStripeSettings(),
    isZoomReady(),
    isZoomSdkReady(),
    getZoomCreds(),
    isAnthropicReady(),
    isGhlReady(),
    isSmtpMarkedDone(),
    readCronHealth(),
    readHealthReport(),
  ]);
  const stripeDone = stripeReady(stripe);
  const zoomHookOk = Boolean(zoomCreds.webhookSecretToken);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
  const billingStatus: BillingStatus = {
    connected: Boolean(stripe?.secretKey),
    accountName: stripe?.accountName ?? "",
    livemode: Boolean(stripe?.livemode),
    productsCreated: Boolean(stripe?.prices.basic && stripe?.prices.pro),
    basicPrice: stripe?.displayPrices?.basic ?? null,
    proPrice: stripe?.displayPrices?.pro ?? null,
    webhookConfigured: Boolean(stripe?.webhookSecret),
    webhookUrl: `${siteUrl}/api/webhooks/stripe`,
  };

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Connections</h2>
          <p>
            Connect every outside service right here — paste, click, done
          </p>
        </div>
        <span className="admin-status draft">
          {/* The host answers "which database am I on?" — with separate
              production and staging Supabase projects, a preview deploy
              must visibly NOT be production (docs/environments.md). */}
          Core database:{" "}
          {isSupabaseConfigured()
            ? (() => {
                try {
                  return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string)
                    .hostname;
                } catch {
                  return "Connected";
                }
              })()
            : "Preview mode"}
        </span>
      </div>

      {!isSuper ? (
        <div className="admin-hint">
          Connections are managed by the Super Admin — ask them for changes
          here.
        </div>
      ) : (
        <div style={{ maxWidth: 860 }}>
          <ConnectionCard
            title="Stripe — payments"
            powers="Members buy and manage Basic/Pro plans themselves"
            connected={stripeDone}
            defaultOpen={!stripeDone}
          >
            <BillingSetup status={billingStatus} />
          </ConnectionCard>

          <ConnectionCard
            title="Zoom — sessions"
            powers="Creates the meeting when a session is published; members join live inside the portal; recordings flow into the Library"
            connected={zoomOk && zoomSdkOk && zoomHookOk}
          >
            <ZoomWizard
              meetingsConnected={zoomOk}
              liveRoomConnected={zoomSdkOk}
              recordingHookConnected={zoomHookOk}
              recordingHookUrl={`${siteUrl}/api/webhooks/zoom`}
            />
          </ConnectionCard>

          <ConnectionCard
            title="Anthropic — AI summaries"
            powers="Automatic takeaways, quotes, and action items after each session"
            connected={anthropicOk}
          >
            <AnthropicWizard />
          </ConnectionCard>

          <ConnectionCard
            title="Go High Level — legacy payments"
            powers="Optional now that Stripe is live; keeps legacy GHL plans syncing"
            connected={ghlOk}
            optional
          >
            <GhlWizard webhookUrl={`${siteUrl}/api/webhooks/ghl`} />
          </ConnectionCard>

          <ConnectionCard
            title="Email — invites and password resets"
            powers="Branded Momentum+ email from your own domain (Resend SMTP through Supabase)"
            connected={smtpDone}
          >
            <SmtpWizard markedDone={smtpDone} />
          </ConnectionCard>

          <ConnectionCard
            title="TSLS bridge / Zapier — auto-onboarding"
            powers="TSLS ticket buyers (and any webhook-capable tool) get accounts and gifts here automatically"
            connected={Boolean(
              process.env.MOMENTUM_BRIDGE_KEY || process.env.ZAPIER_WEBHOOK_SECRET,
            )}
            optional
          >
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", lineHeight: 1.7 }}>
              1. In Vercel add <code>MOMENTUM_BRIDGE_KEY</code> (any long
              random string; the older <code>ZAPIER_WEBHOOK_SECRET</code> also
              still works) and Redeploy — the TSLS app uses the same value as
              its <code>MOMENTUM_PROVISION_KEY</code>. &nbsp;2. For Zapier:
              Webhooks by Zapier → POST → URL{" "}
              <code>{siteUrl}/api/webhooks/zapier</code>, header{" "}
              <code>x-api-key</code> = your key, JSON body with{" "}
              <code>email</code>, <code>name</code>, <code>plan</code> (basic,
              gift, vip, pro, …).
            </div>
          </ConnectionCard>

          <ConnectionCard
            title="Google Sheets — TSLS import"
            powers="Auto-imports Summit registrations into memberships"
            connected={isSheetsConfigured()}
            optional
          >
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", lineHeight: 1.7 }}>
              Google Cloud service account with Sheets read access; share the
              registration sheet with its email. In Vercel add{" "}
              <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code>,{" "}
              <code>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code>, and{" "}
              <code>TSLS_REGISTRATION_SHEET_ID</code>, then Redeploy.
            </div>
          </ConnectionCard>

          {/* Env-configured services with no wizard — previously invisible
              here, so a missing key looked identical to a healthy one. */}
          <div className="section-header" style={{ marginTop: 26 }}>
            <div>
              <h2 style={{ fontSize: 17 }}>Also monitored</h2>
              <p>Set in Vercel — shown read-only so nothing can break silently</p>
            </div>
          </div>
          <div className="card" style={{ padding: 0, maxWidth: 860 }}>
            {[
              {
                name: "Stream Chat",
                ok: isStreamConfigured(),
                what: "The Community tab",
                note: "NEXT_PUBLIC_STREAM_API_KEY + STREAM_API_SECRET",
              },
              {
                name: "Mux video",
                ok: isMuxConfigured(),
                what: "Library and lesson playback. Note: there is no Mux webhook — new uploads become playable via the hourly summaries cron, so allow up to an hour.",
                note: "MUX_TOKEN_ID + MUX_TOKEN_SECRET",
              },
              {
                name: "Resend webhook",
                ok: Boolean(process.env.RESEND_WEBHOOK_SECRET),
                what: "Email delivery/open events on Admin → Email Activity",
                note: "RESEND_WEBHOOK_SECRET (register the endpoint in Resend)",
              },
              {
                name: "Web push",
                ok: pushConfigured(),
                what: "Push notifications to installed apps (both VAPID keys, or sends quietly do nothing)",
                note: "NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY",
              },
              {
                name: "TSLS one-tap sign-in (inbound)",
                ok: Boolean(process.env.SSO_HANDOFF_SECRET),
                what: "TSLS members crossing over into Momentum+ with one tap",
                note: "SSO_HANDOFF_SECRET (= TSLS's MOMENTUM_SSO_KEY)",
              },
              {
                name: "TSLS sync (outbound)",
                ok: Boolean(
                  process.env.TSLS_SSO_KEY && process.env.NEXT_PUBLIC_TSLS_EVENT_URL,
                ),
                what: "Pushing profile/sponsor edits into the TSLS app + the Open TSLS button",
                note: "TSLS_SSO_KEY (= TSLS's TSLS_SSO_SECRET) + NEXT_PUBLIC_TSLS_EVENT_URL",
              },
              {
                name: "Cron jobs",
                ok: Boolean(process.env.CRON_SECRET),
                what: "Reminders, dunning, gifts, imports, recordings — all scheduled work",
                note: "CRON_SECRET (unset = every cron silently does nothing)",
              },
            ].map((r, i) => (
              <div
                key={r.name}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "baseline",
                  padding: "12px 18px",
                  borderTop: i === 0 ? "none" : "1px solid var(--warm-gray)",
                }}
              >
                <strong
                  style={{
                    minWidth: 96,
                    color: r.ok ? "var(--accent-green)" : "var(--gold)",
                    fontSize: 13,
                  }}
                >
                  {r.ok ? "Connected" : "Not set up"}
                </strong>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                  <div style={{ fontSize: 13 }}>{r.what}</div>
                  <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>{r.note}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-header" style={{ marginTop: 26 }}>
            <div>
              <h2 style={{ fontSize: 17 }}>Health checks</h2>
              <p>
                Every 6 hours each service is probed for real — a live API
                call, not just &ldquo;the key is set&rdquo;. You get an email
                when something breaks or recovers.
              </p>
            </div>
            <form action={runHealthNowAction}>
              <button type="submit" className="btn-sm-gold">
                Run checks now
              </button>
            </form>
          </div>
          <div className="card" style={{ padding: 0, maxWidth: 860 }}>
            {!healthReport ? (
              <div style={{ fontSize: 13, color: "var(--mid-gray)", padding: "12px 18px" }}>
                No report yet — run the checks now, or wait for the first
                6-hour cycle after this deploy.
              </div>
            ) : (
              <>
                {healthReport.checks.map((c, i) => (
                  <div
                    key={c.name}
                    style={{
                      display: "flex",
                      gap: 14,
                      alignItems: "baseline",
                      padding: "10px 18px",
                      borderTop: i === 0 ? "none" : "1px solid var(--warm-gray)",
                    }}
                  >
                    <strong
                      style={{
                        minWidth: 96,
                        color: c.skipped
                          ? "var(--mid-gray)"
                          : c.ok
                            ? "var(--accent-green)"
                            : "#c0392b",
                        fontSize: 13,
                      }}
                    >
                      {c.skipped ? "Not set up" : c.ok ? "Passing" : "FAILING"}
                    </strong>
                    <div>
                      <strong style={{ fontSize: 13.5 }}>{c.name}</strong>
                      <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                        {c.note}
                      </div>
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--mid-gray)",
                    padding: "10px 18px",
                    borderTop: "1px solid var(--warm-gray)",
                  }}
                >
                  Last checked{" "}
                  {new Date(healthReport.at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </>
            )}
          </div>

          <div className="section-header" style={{ marginTop: 26 }}>
            <div>
              <h2 style={{ fontSize: 17 }}>Scheduled jobs</h2>
              <p>Last successful run of each cron — a job missing or stale here needs attention</p>
            </div>
          </div>
          <div className="card" style={{ padding: "12px 18px", maxWidth: 860 }}>
            {Object.keys(cronHealth).length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--mid-gray)" }}>
                No runs recorded yet — each cron appears here after its first
                successful run. If this stays empty for a day, check that{" "}
                <code>CRON_SECRET</code> is set and the Vercel cron schedule is
                active.
              </div>
            ) : (
              Object.entries(cronHealth)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, run]) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 13,
                      padding: "4px 0",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span style={{ color: "var(--mid-gray)" }}>
                      {new Date(run.at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {run.note ? ` — ${run.note}` : ""}
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
