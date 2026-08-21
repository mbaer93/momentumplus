"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatAt } from "@/lib/time-format";
import {
  confirmMfaEnrollment,
  disableMfa,
  startMfaEnrollment,
} from "@/app/(portal)/admin/security/actions";

/*
 * Turning on two-factor for an admin account (Matt, 2026-08-19 — "I want to
 * use 1Password for this").
 *
 * So the setup secret is offered as TEXT first and the QR second. 1Password
 * takes a one-time-password secret pasted into the field on the same login
 * item, which is the flow Matt will actually use; a QR is what you need
 * when the authenticator is a phone app. Most guides lead with the QR and
 * bury the secret behind "can't scan?", which is backwards here.
 */

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  createdAt: string;
}

export function MfaSetup({
  factors,
  isSuper,
}: {
  factors: MfaFactor[];
  isSuper: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [setup, setSetup] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeCode, setRemoveCode] = useState("");

  const on = factors.length > 0;

  return (
    <div className="admin-form" style={{ maxWidth: "none" }}>
      <div className="admin-field" style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 13 }}>Two-factor authentication</label>
      </div>

      <p
        style={{
          fontSize: 12.5,
          color: "var(--ink-secondary)",
          margin: "0 0 14px",
          lineHeight: 1.6,
          maxWidth: "68ch",
        }}
      >
        This account can read every member&apos;s contact details and can issue
        a link that signs you in as any member. A second factor means a stolen
        password is not enough to do either. Once it is on, this account needs a
        code after the password &mdash; on a new browser, and after signing out.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "3px 9px",
            borderRadius: 4,
            border: "1px solid currentColor",
            color: on ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {on ? "On" : "Off"}
        </span>
        {!on && isSuper && (
          <span style={{ fontSize: 12.5, color: "#9B3C3C" }}>
            The strongest account on the platform is protected by a password
            alone.
          </span>
        )}
      </div>

      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginBottom: 12 }}
        >
          {msg.text}
        </div>
      )}

      {/* --- Already on: list factors, offer removal ------------------- */}
      {on &&
        factors.map((f) => (
          <div
            key={f.id}
            style={{
              borderTop: "1px solid var(--border)",
              padding: "10px 0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13 }}>
              <strong>{f.friendlyName || "Authenticator"}</strong>
              <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                Added{" "}
                {/* Through formatAt, which pins the zone. Formatting with
                    no timeZone would format in the RENDERER's zone — UTC on
                    Vercel, the admin's own in the browser — and the two
                    would disagree about a factor enrolled late in the
                    evening. An admin record stays on the event's clock. */}
                {formatAt(f.createdAt, "date")}
              </div>
            </div>
            {removing === f.id ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={removeCode}
                  onChange={(e) => setRemoveCode(e.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  style={{ width: 110, fontFamily: "ui-monospace, monospace" }}
                />
                <button
                  type="button"
                  className="btn-mini danger"
                  disabled={pending}
                  onClick={() => {
                    setMsg(null);
                    startTransition(async () => {
                      const res = await disableMfa(f.id, removeCode);
                      setMsg({ ok: res.ok, text: res.message });
                      setRemoveCode("");
                      if (res.ok) {
                        setRemoving(null);
                        router.refresh();
                      }
                    });
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => {
                    setRemoving(null);
                    setRemoveCode("");
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-mini"
                onClick={() => setRemoving(f.id)}
              >
                Turn off
              </button>
            )}
          </div>
        ))}

      {/* --- Not on yet: enrol ----------------------------------------- */}
      {!on && !setup && (
        <button
          type="button"
          className="btn-gold"
          disabled={pending}
          onClick={() => {
            setMsg(null);
            startTransition(async () => {
              const res = await startMfaEnrollment();
              if (res.ok && res.factorId && res.qr && res.secret) {
                setSetup({ factorId: res.factorId, qr: res.qr, secret: res.secret });
              } else {
                setMsg({ ok: false, text: res.message ?? "Couldn't start." });
              }
            });
          }}
        >
          {pending ? "Starting…" : "Turn on two-factor"}
        </button>
      )}

      {setup && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              1. Put this secret in 1Password
            </div>
            <p
              style={{
                fontSize: 12.5,
                color: "var(--ink-secondary)",
                margin: "0 0 8px",
                lineHeight: 1.6,
                maxWidth: "68ch",
              }}
            >
              Open the Momentum+ login item, add a one-time password field, and
              paste this into it. 1Password will start showing a six-digit code
              that changes every 30 seconds.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code
                style={{
                  fontSize: 13,
                  letterSpacing: "0.08em",
                  wordBreak: "break-all",
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  flex: "1 1 260px",
                }}
              >
                {setup.secret}
              </code>
              <button
                type="button"
                className="btn-mini"
                onClick={() => void navigator.clipboard.writeText(setup.secret)}
              >
                Copy
              </button>
            </div>
            <button
              type="button"
              className="btn-mini"
              style={{ marginTop: 8 }}
              onClick={() => setShowQr((v) => !v)}
            >
              {showQr ? "Hide QR code" : "Show a QR code instead"}
            </button>
            {showQr && (
              <div
                style={{
                  marginTop: 10,
                  background: "#fff",
                  padding: 12,
                  borderRadius: 4,
                  width: "fit-content",
                }}
                /* Supabase returns an SVG data URI; rendered as an image so
                   nothing from that string is ever parsed as markup. */
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={setup.qr} alt="Two-factor setup QR code" width={180} height={180} />
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              2. Enter the code it shows
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Six-digit code"
                style={{ width: 130, fontFamily: "ui-monospace, monospace", fontSize: 16 }}
              />
              <button
                type="button"
                className="btn-gold"
                disabled={pending}
                onClick={() => {
                  setMsg(null);
                  startTransition(async () => {
                    const res = await confirmMfaEnrollment(setup.factorId, code);
                    setMsg({ ok: res.ok, text: res.message });
                    setCode("");
                    if (res.ok) {
                      setSetup(null);
                      router.refresh();
                    }
                  });
                }}
              >
                {pending ? "Checking…" : "Confirm and turn on"}
              </button>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => {
                  setSetup(null);
                  setCode("");
                }}
              >
                Cancel
              </button>
            </div>
            <p
              style={{
                fontSize: 12,
                color: "var(--ink-secondary)",
                margin: "10px 0 0",
                maxWidth: "68ch",
                lineHeight: 1.6,
              }}
            >
              Nothing changes until this code is confirmed &mdash; so if the
              secret was pasted somewhere it will not persist, you find out now
              rather than at the next sign-in.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
