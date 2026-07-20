"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Mode = "password" | "magic";

/**
 * Same-site redirects only — a crafted ?redirect=https://evil.example on a
 * phishing link must never bounce a freshly signed-in member off-site.
 * Mirrors the validation in /auth/callback and /auth/confirm.
 */
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect"));
  const configured = isSupabaseConfigured();

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Surface errors handed back by the auth callback (expired/used links).
  const [error, setError] = useState<string | null>(
    searchParams.get("error"),
  );
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Phase 1 dev mode: no Supabase configured → enter the shell directly.
    if (!configured) {
      router.push(redirectTo);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            // The members-only login page must not double as a signup form —
            // strangers (and typos) don't get accounts minted here.
            shouldCreateUser: false,
            emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(
              redirectTo,
            )}`,
          },
        });
        if (error) {
          // Unknown email with shouldCreateUser=false surfaces as
          // "Signups not allowed for otp" — meaningless jargon that also
          // leaks whether an address has an account. Stay neutral.
          if (/signups not allowed/i.test(error.message)) {
            setNotice(
              "If an account exists for that email, a sign-in link is on its way — check your inbox.",
            );
            return;
          }
          throw error;
        }
        setNotice("Check your email for a magic sign-in link.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(redirectTo);
        router.refresh();
      }
    } catch (err) {
      // Auth service errors occasionally surface with empty/JSON-blob messages
      // (e.g. "{}" on a 5xx) — show something a member can act on instead.
      const raw = err instanceof Error ? err.message.trim() : "";
      const usable = raw && raw !== "{}" && !raw.startsWith("{\"");
      setError(
        usable
          ? raw
          : "We couldn't sign you in. Please try again in a moment, or use the password reset link below.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-card">
      <div className="login-badge">Members Only · Tri-State Leadership Summit</div>
      <h2>Welcome back</h2>
      <p>
        {mode === "magic"
          ? "Enter your email and we'll send a secure sign-in link."
          : "Sign in to your Momentum+ member portal."}
      </p>

      {!configured && (
        <div className="login-success">
          Preview mode: Supabase isn&apos;t configured yet, so sign-in is
          bypassed. Set the Supabase env vars in <code>.env.local</code> to
          enable real auth.
        </div>
      )}
      {error && <div className="login-error">{error}</div>}
      {notice && <div className="login-success">{notice}</div>}

      <form onSubmit={onSubmit}>
        <div className="login-field">
          <label htmlFor="email">Email (this is your username)</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {mode === "password" && (
          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        )}

        <button type="submit" className="login-btn" disabled={loading}>
          {loading
            ? "Please wait…"
            : mode === "magic"
              ? "Send magic link"
              : "Sign in"}
        </button>
      </form>

      <div className="login-alt">
        {mode === "password" ? (
          <>
            Prefer a passwordless link?{" "}
            <button type="button" onClick={() => setMode("magic")}>
              Email me a magic link
            </button>
          </>
        ) : (
          <>
            Use a password instead?{" "}
            <button type="button" onClick={() => setMode("password")}>
              Sign in with password
            </button>
          </>
        )}
      </div>

      <div className="login-links">
        <a href={`${process.env.NEXT_PUBLIC_MOMENTUM_URL ?? "https://momentumplus.co"}/reset`}>Forgot your password?</a>
      </div>
    </div>
  );
}
