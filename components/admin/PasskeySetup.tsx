"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmPasskeyEnrollment,
  removePasskey,
  startPasskeyEnrollment,
} from "@/app/(portal)/admin/security/actions";
import type { MfaFactorRow } from "@/lib/mfa";
import { decodeCredentialOptions, encodeCredential } from "@/lib/webauthn-encoding";

/*
 * Passkeys, alongside the authenticator code (Matt, 2026-08-21: "can we
 * switch this to a passkey with 1Password rather than an otp?").
 *
 * ALONGSIDE, not instead of, and deliberately:
 *
 *  - A passkey is bound to this exact domain. That is what makes it
 *    phishing-resistant, and also why it cannot be tested on a preview URL.
 *  - Losing it is harder to recover from than losing a TOTP secret. A code
 *    can be re-added from 1Password; a lost passkey means deleting the
 *    factor row in the database to get back in. Two factors means either
 *    one works.
 *  - Supabase ships this in beta.
 *
 * The gate itself needed no changes: both are MFA factors, both raise the
 * session to aal2, and mustVerify was already factor-agnostic.
 */

export function PasskeySetup({ passkeys }: { passkeys: MfaFactorRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const supported =
    typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

  async function enrol() {
    setMsg(null);
    setBusy(true);
    try {
      const start = await startPasskeyEnrollment();
      if (!start.ok || !start.options || !start.factorId || !start.challengeId) {
        setMsg({ ok: false, text: start.message ?? "Couldn't start." });
        return;
      }
      const credential = (await navigator.credentials.create({
        publicKey: decodeCredentialOptions(start.options as Record<string, unknown>),
      })) as PublicKeyCredential | null;
      if (!credential) {
        setMsg({ ok: false, text: "No passkey was created." });
        return;
      }
      const res = await confirmPasskeyEnrollment(
        start.factorId,
        start.challengeId,
        encodeCredential(credential),
      );
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    } catch (e) {
      /*
       * NotAllowedError covers a cancel, a timeout AND a wrong origin, so
       * the message must not claim to know which. Naming the likely causes
       * is more use than "failed" — particularly the origin one, which is
       * what happens on a preview deployment.
       */
      setMsg({
        ok: false,
        text:
          e instanceof Error && e.name === "NotAllowedError"
            ? "The prompt was dismissed, timed out, or this isn't the domain the passkey belongs to. Enrol from the real site, not a preview URL."
            : `Couldn't create a passkey: ${e instanceof Error ? e.message : "unknown error"}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginTop: 28 }}>
      <div className="admin-field" style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 13 }}>Passkeys</label>
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
        A passkey signs you in with one tap and cannot be phished — it only
        works on this exact site, so a convincing copy of it gets nothing.
        1Password stores and fills them. Keep your authenticator code as
        well: a lost code can be restored from 1Password, while a lost
        passkey needs database access to clear.
      </p>

      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}

      {passkeys.map((k) => (
        <div
          key={k.id}
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
            <strong>{k.friendlyName || "Passkey"}</strong>
            <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
              Added{" "}
              {new Date(k.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
          <button
            type="button"
            className="btn-mini"
            disabled={pending}
            onClick={() => {
              setMsg(null);
              startTransition(async () => {
                const res = await removePasskey(k.id);
                setMsg({ ok: res.ok, text: res.message });
                if (res.ok) router.refresh();
              });
            }}
          >
            Remove
          </button>
        </div>
      ))}

      {!supported ? (
        <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", margin: 0 }}>
          This browser doesn&apos;t support passkeys.
        </p>
      ) : (
        <button
          type="button"
          className="btn-gold"
          disabled={busy || pending}
          onClick={() => void enrol()}
          style={{ marginTop: passkeys.length > 0 ? 12 : 0 }}
        >
          {busy
            ? "Waiting for your passkey…"
            : passkeys.length > 0
              ? "Add another passkey"
              : "Add a passkey"}
        </button>
      )}
    </div>
  );
}
