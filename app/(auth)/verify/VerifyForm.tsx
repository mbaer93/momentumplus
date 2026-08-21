"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startPasskeyVerification,
  verifyPasskey,
  verifySecondFactor,
} from "./actions";
import { decodeCredentialOptions, encodeCredential } from "@/lib/webauthn-encoding";

/*
 * Six digits between an admin's password and the member data behind it.
 *
 * autoComplete="one-time-code" is what lets 1Password (and iOS) offer the
 * current code straight from the login item, which is the whole point of
 * keeping the secret there rather than on a separate device.
 */
export function VerifyForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  /*
   * The passkey path (Matt, 2026-08-21). Not named usePasskey: React
   * treats a "use" prefix as a hook and the rules-of-hooks lint rejects
   * calling it from an onClick. Offered first because it is one
   * click and cannot be phished, with the code kept underneath as the
   * fallback — losing a passkey is harder to recover from than losing a
   * TOTP secret, so both stay enrolled.
   *
   * WebAuthn only works on the origin the passkey was created for, so a
   * preview URL will fail here even when everything is configured. That is
   * the property doing the security work, not a bug.
   */
  async function signInWithPasskey() {
    setError(null);
    setPasskeyBusy(true);
    try {
      const start = await startPasskeyVerification();
      if (!start.ok || !start.options || !start.factorId || !start.challengeId) {
        setError(start.message ?? "No passkey on this account — use your code.");
        return;
      }
      const credential = (await navigator.credentials.get({
        publicKey: decodeCredentialOptions(start.options as Record<string, unknown>),
      })) as PublicKeyCredential | null;
      if (!credential) {
        setError("No passkey was offered. Try again, or use your code.");
        return;
      }
      const res = await verifyPasskey(
        start.factorId,
        start.challengeId,
        encodeCredential(credential),
        redirectTo,
      );
      if (res.ok) {
        window.location.assign(res.redirectTo ?? "/admin");
        return;
      }
      setError(res.message);
    } catch (e) {
      /*
       * The browser says NotAllowedError for a cancel, a timeout, AND a
       * wrong origin, so the message cannot claim to know which. Naming
       * the likely causes beats a bare "failed".
       */
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "The passkey prompt was dismissed or timed out. Try again, or use your code below."
          : "This browser couldn't use a passkey. Use your code below.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await verifySecondFactor(code, redirectTo);
      if (res.ok) {
        // A full reload, not a soft push: the session's assurance level
        // changed, and every server component needs to read it again.
        window.location.assign(res.redirectTo ?? "/admin");
        return;
      }
      setError(res.message);
      setCode("");
    });
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <h2>Enter your code</h2>
      <p style={{ fontSize: 13, color: "var(--mid-gray)", margin: "0 0 16px" }}>
        This account has two-factor turned on. Use your passkey if you have
        one, or open the Momentum+ item in 1Password and enter the
        six-digit code it shows.
      </p>

      {error && <div className="login-error">{error}</div>}

      <button
        type="button"
        className="login-btn"
        disabled={passkeyBusy || pending}
        onClick={() => void signInWithPasskey()}
        style={{ marginBottom: 18 }}
      >
        {passkeyBusy ? "Waiting for your passkey…" : "Use a passkey"}
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "0 0 16px",
          fontSize: 12,
          color: "var(--mid-gray)",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.14)" }} />
        or
        <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.14)" }} />
      </div>

      <label htmlFor="mfa-code">Six-digit code</label>
      <input
        id="mfa-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        placeholder="000000"
        style={{ fontFamily: "ui-monospace, monospace", fontSize: 18, letterSpacing: "0.15em" }}
      />

      <button type="submit" className="login-btn" disabled={pending || code.length < 6}>
        {pending ? "Checking…" : "Verify"}
      </button>

      <div className="login-alt" style={{ marginTop: 14 }}>
        Locked out?{" "}
        <button
          type="button"
          onClick={() => {
            void fetch("/auth/signout", { method: "POST" }).then(() =>
              router.push("/login"),
            );
          }}
        >
          Sign out
        </button>
      </div>
    </form>
  );
}
