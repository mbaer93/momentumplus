"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  connectAnthropic,
  connectGhl,
  connectZoomS2S,
  connectZoomSdk,
  markSmtpDone,
  sendSmtpTestEmail,
} from "@/app/(portal)/admin/connections/actions";

/*
 * Spoon-fed connect wizards for the Connections tab. Each one names the
 * exact clicks in the outside service, takes the pasted values, validates
 * them against the real API, and stores them — no Vercel, no code.
 */

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't go through — try again.", ok: false });
      }
    });
  }
  return { pending, msg, run };
}

function Msg({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <div
      className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
      style={{ marginTop: 8 }}
    >
      {msg.text}
    </div>
  );
}

const stepStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--mid-gray)",
  margin: "6px 0 10px",
  lineHeight: 1.7,
};

// ---------------------------------------------------------------------------

export function ZoomWizard({
  meetingsConnected,
  liveRoomConnected,
}: {
  meetingsConnected: boolean;
  liveRoomConnected: boolean;
}) {
  const { pending, msg, run } = useRun();
  const [s2s, setS2s] = useState({ accountId: "", clientId: "", clientSecret: "" });
  const [sdk, setSdk] = useState({ id: "", secret: "" });

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 4 }}>
        Part 1 of 2 — Meetings ({meetingsConnected ? "done" : "not connected"})
      </div>
      <div style={stepStyle}>
        1. Go to <strong>marketplace.zoom.us</strong> and sign in with the Zoom
        account that will host sessions. &nbsp;2. Top right: <strong>Develop →
        Build App</strong>. &nbsp;3. Choose <strong>Server-to-Server OAuth</strong>{" "}
        and name it &ldquo;Momentum Plus&rdquo;. &nbsp;4. On the App Credentials
        page, copy the three values below. &nbsp;5. Under <strong>Scopes</strong>,
        add <code>meeting:write:admin</code> and <code>report:read:admin</code>,
        then click <strong>Activate</strong>. &nbsp;6. Paste and connect:
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        <input
          placeholder="Account ID"
          value={s2s.accountId}
          onChange={(e) => setS2s({ ...s2s, accountId: e.target.value })}
          aria-label="Zoom Account ID"
        />
        <input
          placeholder="Client ID"
          value={s2s.clientId}
          onChange={(e) => setS2s({ ...s2s, clientId: e.target.value })}
          aria-label="Zoom Client ID"
        />
        <input
          type="password"
          placeholder="Client Secret"
          value={s2s.clientSecret}
          onChange={(e) => setS2s({ ...s2s, clientSecret: e.target.value })}
          aria-label="Zoom Client Secret"
        />
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !s2s.accountId || !s2s.clientId || !s2s.clientSecret}
          onClick={() =>
            run(async () => {
              const res = await connectZoomS2S(
                s2s.accountId,
                s2s.clientId,
                s2s.clientSecret,
              );
              if (res.ok) setS2s({ accountId: "", clientId: "", clientSecret: "" });
              return res;
            })
          }
        >
          Connect meetings
        </button>
      </div>

      <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 16 }}>
        Part 2 of 2 — In-portal live room (
        {liveRoomConnected ? "done" : "not connected"})
      </div>
      <div style={stepStyle}>
        Same place: <strong>Develop → Build App</strong>, but this time choose{" "}
        <strong>General App</strong> (or Meeting SDK, if listed), name it
        &ldquo;Momentum Plus Live Room&rdquo;, and enable the{" "}
        <strong>Meeting SDK</strong> feature. Copy the <strong>Client ID</strong>{" "}
        and <strong>Client Secret</strong> from its credentials page:
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        <input
          placeholder="SDK Client ID"
          value={sdk.id}
          onChange={(e) => setSdk({ ...sdk, id: e.target.value })}
          aria-label="Zoom SDK Client ID"
        />
        <input
          type="password"
          placeholder="SDK Client Secret"
          value={sdk.secret}
          onChange={(e) => setSdk({ ...sdk, secret: e.target.value })}
          aria-label="Zoom SDK Client Secret"
        />
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !sdk.id || !sdk.secret}
          onClick={() =>
            run(async () => {
              const res = await connectZoomSdk(sdk.id, sdk.secret);
              if (res.ok) setSdk({ id: "", secret: "" });
              return res;
            })
          }
        >
          Connect live room
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AnthropicWizard() {
  const { pending, msg, run } = useRun();
  const [key, setKey] = useState("");

  return (
    <div>
      <div style={stepStyle}>
        1. Go to <strong>console.anthropic.com</strong> and sign in (create the
        account if needed and add a payment method under Billing). &nbsp;2. Left
        menu: <strong>API keys → Create key</strong>, name it &ldquo;Momentum
        Plus&rdquo;. &nbsp;3. Copy the key (starts with <code>sk-ant-</code>) —
        it&apos;s shown only once. &nbsp;4. Paste and connect:
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0 }}>
        <input
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ flex: 1, minWidth: 240 }}
          aria-label="Anthropic API key"
        />
        <button
          type="button"
          className="btn-purple"
          disabled={pending || key.trim().length < 12}
          onClick={() =>
            run(async () => {
              const res = await connectAnthropic(key);
              if (res.ok) setKey("");
              return res;
            })
          }
        >
          Connect Anthropic
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function GhlWizard({ webhookUrl }: { webhookUrl: string }) {
  const { pending, msg, run } = useRun();
  const [form, setForm] = useState({ apiKey: "", locationId: "", secret: "" });

  return (
    <div>
      <div style={stepStyle}>
        Only needed if you keep selling through GHL. &nbsp;1. In GHL:{" "}
        <strong>Settings → Private Integrations → Create</strong> — enable
        contact read scopes and copy the token. &nbsp;2. <strong>Settings →
        Business Profile</strong> — copy the Location ID. &nbsp;3. Make up a
        long random <strong>webhook secret</strong> (any passphrase) — you&apos;ll
        also set it in the GHL workflow&apos;s Custom Webhook header{" "}
        <code>x-webhook-secret</code>, pointed at <code>{webhookUrl}</code>.
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        <input
          type="password"
          placeholder="Private integration token"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          aria-label="GHL API key"
        />
        <input
          placeholder="Location ID"
          value={form.locationId}
          onChange={(e) => setForm({ ...form, locationId: e.target.value })}
          aria-label="GHL Location ID"
        />
        <input
          type="password"
          placeholder="Webhook secret"
          value={form.secret}
          onChange={(e) => setForm({ ...form, secret: e.target.value })}
          aria-label="GHL webhook secret"
        />
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !form.apiKey || !form.locationId}
          onClick={() =>
            run(async () => {
              const res = await connectGhl(form.apiKey, form.locationId, form.secret);
              if (res.ok) setForm({ apiKey: "", locationId: "", secret: "" });
              return res;
            })
          }
        >
          Connect GHL
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SmtpWizard({ markedDone }: { markedDone: boolean }) {
  const { pending, msg, run } = useRun();

  return (
    <div>
      <div style={stepStyle}>
        Invite and password emails are sent by Supabase. The built-in sender is
        limited to a few emails per hour — fine for testing, not for real
        onboarding. To use your own sender: &nbsp;1. Get SMTP credentials from
        your email provider (SendGrid, Mailgun, Google Workspace, or GHL&apos;s
        SMTP — host, port, username, password). &nbsp;2. Open{" "}
        <strong>supabase.com/dashboard</strong> → your project →{" "}
        <strong>Authentication → Emails → SMTP Settings</strong>. &nbsp;3. Toggle{" "}
        <strong>Enable Custom SMTP</strong>, paste the credentials, set the
        sender name to &ldquo;Momentum+&rdquo;, and <strong>Save</strong>.
        &nbsp;4. While you&apos;re there: <strong>Authentication → Emails →
        Templates → Invite user</strong> — paste in the branded Momentum+
        welcome email (the team has it as{" "}
        <code>docs/email-templates/invite-email.html</code>) and set the
        subject to &ldquo;Welcome to Momentum+ — your membership is
        ready&rdquo;. &nbsp;5. Prove it works:
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="btn-purple"
          disabled={pending}
          onClick={() => run(() => sendSmtpTestEmail())}
        >
          Send me a test email
        </button>
        <button
          type="button"
          className="btn-mini"
          disabled={pending}
          onClick={() => run(() => markSmtpDone(!markedDone))}
        >
          {markedDone ? "Mark as not configured" : "Mark as configured"}
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}
