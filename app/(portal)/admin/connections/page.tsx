import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { isAnthropicConfigured } from "@/lib/ai-summary";
import { getAdminAccess } from "@/lib/auth-helpers";
import { isGhlConfigured } from "@/lib/ghl";
import { isMuxConfigured } from "@/lib/mux";
import { isSheetsConfigured } from "@/lib/sheets";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { isStreamConfigured } from "@/lib/stream";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isZoomConfigured } from "@/lib/zoom";
import { isZoomSdkConfigured } from "@/lib/zoom-signature";

export const dynamic = "force-dynamic";

/*
 * One place to see every outside service the platform talks to: what it
 * powers, whether it's connected, and exactly how to connect it. Stripe
 * connects in-app (Billing wizard); the rest are keys added in Vercel →
 * Settings → Environment Variables, then Redeploy.
 */

interface Connection {
  name: string;
  powers: string;
  connected: boolean;
  detail: string;
  how: string;
  href?: { label: string; url: string };
  optional?: boolean;
}

export default async function AdminConnectionsPage() {
  const access = await getAdminAccess();
  const isSuper = access?.role === "super";

  const stripe = await getStripeSettings();
  const stripeDone = stripeReady(stripe);
  let stripeDetail = "Not connected";
  if (stripe?.secretKey) {
    // Recomputed inline (not via the stripeReady type guard) so TS doesn't
    // narrow `stripe` to null in the incomplete branch.
    const complete = Boolean(
      stripe.prices.basic && stripe.prices.pro && stripe.webhookSecret,
    );
    stripeDetail = complete
      ? `Connected to ${stripe.accountName}${stripe.livemode ? "" : " (test mode)"} · Basic $${stripe.displayPrices?.basic}/mo · Pro $${stripe.displayPrices?.pro}/mo`
      : `Connected to ${stripe.accountName} — finish the remaining wizard steps`;
  }

  const connections: Connection[] = [
    {
      name: "Stripe",
      powers: "Member payments — self-serve Basic/Pro subscriptions, upgrades, cancellations",
      connected: stripeDone,
      detail: stripeDetail,
      how: "Use the guided wizard — paste one key, type the prices, one click for the rest.",
      href: { label: "Open the Billing wizard", url: "/admin/billing" },
    },
    {
      name: "Zoom (meetings)",
      powers: "Creating the Zoom meeting when a session is published + attendance reports",
      connected: isZoomConfigured(),
      detail: isZoomConfigured() ? "Connected" : "Not connected",
      how: "Zoom App Marketplace → Build App → Server-to-Server OAuth. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in Vercel.",
    },
    {
      name: "Zoom (embedded live room)",
      powers: "Members joining live sessions inside the portal instead of the Zoom app",
      connected: isZoomSdkConfigured(),
      detail: isZoomSdkConfigured() ? "Connected" : "Not connected",
      how: "Zoom App Marketplace → Build App → Meeting SDK. Add ZOOM_SDK_CLIENT_ID and ZOOM_SDK_CLIENT_SECRET in Vercel.",
    },
    {
      name: "Stream Chat",
      powers: "Community channels, admin badges, message moderation",
      connected: isStreamConfigured(),
      detail: isStreamConfigured() ? "Connected" : "Not connected",
      how: "getstream.io → create app → copy Key + Secret. Add NEXT_PUBLIC_STREAM_API_KEY and STREAM_API_SECRET in Vercel.",
    },
    {
      name: "Mux",
      powers: "Video hosting + playback for Library recordings",
      connected: isMuxConfigured(),
      detail: isMuxConfigured() ? "Connected" : "Not connected",
      how: "mux.com → Settings → Access Tokens → new token (Mux Video, full access). Add MUX_TOKEN_ID and MUX_TOKEN_SECRET in Vercel.",
    },
    {
      name: "Anthropic (Claude)",
      powers: "AI session summaries — takeaways, quotes, action items",
      connected: isAnthropicConfigured(),
      detail: isAnthropicConfigured() ? "Connected" : "Not connected",
      how: "console.anthropic.com → API keys → create key. Add ANTHROPIC_API_KEY in Vercel.",
    },
    {
      name: "Zapier / inbound onboarding",
      powers: "Auto-enrolling members from any tool that can send a webhook",
      connected: Boolean(process.env.ZAPIER_WEBHOOK_SECRET),
      detail: process.env.ZAPIER_WEBHOOK_SECRET ? "Connected" : "Not connected",
      how: "Add ZAPIER_WEBHOOK_SECRET (any long random string) in Vercel, then use it as the x-api-key header in a Webhooks-by-Zapier POST to /api/webhooks/zapier.",
    },
    {
      name: "Email (Supabase SMTP)",
      powers: "Invite + password emails for new members",
      connected: true,
      detail:
        "Built-in sender works but is rate-limited — add custom SMTP before bulk imports",
      how: "Supabase dashboard → Authentication → Emails → SMTP settings: paste credentials from your email provider (e.g. SendGrid, Mailgun, or GHL's SMTP).",
      optional: true,
    },
    {
      name: "Go High Level (legacy)",
      powers: "Optional now that Stripe is the payment path — kept for webhook-synced legacy plans",
      connected: isGhlConfigured(),
      detail: isGhlConfigured() ? "Connected" : "Not connected",
      how: "Add GHL_API_KEY, GHL_LOCATION_ID, GHL_WEBHOOK_SECRET in Vercel (only if you keep selling through GHL).",
      optional: true,
    },
    {
      name: "Google Sheets (TSLS import)",
      powers: "Auto-importing Summit registrations into memberships",
      connected: isSheetsConfigured(),
      detail: isSheetsConfigured() ? "Connected" : "Not connected",
      how: "Google Cloud service account with Sheets read access; share the registration sheet with it. Add GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, TSLS_REGISTRATION_SHEET_ID in Vercel.",
      optional: true,
    },
  ];

  const core = isSupabaseConfigured();

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Connections</h2>
          <p>Every outside service the platform uses, in one place</p>
        </div>
        <span className="admin-status draft">
          Core database: {core ? "Connected" : "Preview mode"}
        </span>
      </div>

      {!isSuper && (
        <div className="admin-hint">
          Connection changes are handled by the Super Admin — this view is
          read-only for you.
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>How to connect</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.name}>
                <td style={{ minWidth: 180 }}>
                  <div className="admin-row-title">{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                    {c.powers}
                  </div>
                </td>
                <td style={{ minWidth: 140 }}>
                  <span
                    className={`admin-status ${c.connected ? "completed" : "draft"}`}
                  >
                    {c.connected ? "Connected" : c.optional ? "Optional" : "Needed"}
                  </span>
                  <div
                    style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 4 }}
                  >
                    {c.detail}
                  </div>
                </td>
                <td style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                  {c.how}
                  {c.href && (
                    <div style={{ marginTop: 6 }}>
                      <Link href={c.href.url} className="btn-mini">
                        {c.href.label}
                      </Link>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-hint" style={{ marginTop: 16 }}>
        Environment keys go in <strong>Vercel → momentumplus → Settings →
        Environment Variables</strong> (Production), then Deployments → latest →
        Redeploy. Stripe is the exception — it connects right here in the app
        via the Billing wizard, no Vercel needed.
      </div>
    </div>
  );
}
