"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifySecondFactor } from "./actions";

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
        This account has two-factor turned on. Open the Momentum+ item in
        1Password and enter the six-digit code it shows.
      </p>

      {error && <div className="login-error">{error}</div>}

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
