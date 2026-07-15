import Link from "next/link";
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
import { ArrowLeftIcon } from "@/components/icons";
import { getAdminAccess } from "@/lib/auth-helpers";
import { isMuxConfigured } from "@/lib/mux";
import {
  isAnthropicReady,
  isGhlReady,
  isSmtpMarkedDone,
  isZoomReady,
  isZoomSdkReady,
} from "@/lib/service-config";
import { isSheetsConfigured } from "@/lib/sheets";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { isStreamConfigured } from "@/lib/stream";
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

  const [stripe, zoomOk, zoomSdkOk, anthropicOk, ghlOk, smtpDone] =
    await Promise.all([
      getStripeSettings(),
      isZoomReady(),
      isZoomSdkReady(),
      isAnthropicReady(),
      isGhlReady(),
      isSmtpMarkedDone(),
    ]);
  const stripeDone = stripeReady(stripe);

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
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Connections</h2>
          <p>
            Connect every outside service right here — paste, click, done
          </p>
        </div>
        <span className="admin-status draft">
          Core database: {isSupabaseConfigured() ? "Connected" : "Preview mode"}
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
            powers="Creates the meeting when a session is published; members join live inside the portal"
            connected={zoomOk && zoomSdkOk}
          >
            <ZoomWizard
              meetingsConnected={zoomOk}
              liveRoomConnected={zoomSdkOk}
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
            title="Email — invites & passwords"
            powers="Welcome/invite emails for new members (built-in sender is rate-limited)"
            connected={smtpDone}
          >
            <SmtpWizard markedDone={smtpDone} />
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
            title="Stream — community chat"
            powers="Channels, admin badges, moderation"
            connected={isStreamConfigured()}
            optional={false}
          >
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", lineHeight: 1.7 }}>
              Connected via Vercel keys (already done). To change accounts:
              getstream.io → create app → copy Key + Secret → Vercel →
              Settings → Environment Variables → update{" "}
              <code>NEXT_PUBLIC_STREAM_API_KEY</code> and{" "}
              <code>STREAM_API_SECRET</code> → Redeploy.
            </div>
          </ConnectionCard>

          <ConnectionCard
            title="Mux — video hosting"
            powers="Streams the Library recordings with real access control"
            connected={isMuxConfigured()}
          >
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", lineHeight: 1.7 }}>
              1. Create an account at <strong>mux.com</strong>. &nbsp;2.
              Settings → Access Tokens → Generate new token (environment:
              Production, permission: Mux Video full access). &nbsp;3. In
              Vercel → momentumplus → Settings → Environment Variables add{" "}
              <code>MUX_TOKEN_ID</code> and <code>MUX_TOKEN_SECRET</code>{" "}
              (Production). &nbsp;4. Deployments → latest → Redeploy. Upload
              videos in Mux, then paste each recording&apos;s Playback ID in
              Admin → Library.
            </div>
          </ConnectionCard>

          <ConnectionCard
            title="Zapier — auto-onboarding"
            powers="Any tool that can send a webhook can enroll members automatically"
            connected={Boolean(process.env.ZAPIER_WEBHOOK_SECRET)}
            optional
          >
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", lineHeight: 1.7 }}>
              1. In Vercel add <code>ZAPIER_WEBHOOK_SECRET</code> (any long
              random string) and Redeploy. &nbsp;2. In Zapier: Webhooks by
              Zapier → POST → URL <code>{siteUrl}/api/webhooks/zapier</code>,
              header <code>x-api-key</code> = your secret, JSON body with{" "}
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
        </div>
      )}
    </div>
  );
}
