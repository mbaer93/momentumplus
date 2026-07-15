"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Mode = "password" | "magic";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";
  const configured = isSupabaseConfigured();

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
            emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(
              redirectTo,
            )}`,
          },
        });
        if (error) throw error;
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
          <label htmlFor="email">Email</label>
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
        <Link href="/reset">Forgot your password?</Link>
      </div>
    </div>
  );
}
