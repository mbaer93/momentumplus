"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function ResetForm() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!configured) {
      setSent(true);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?redirect=/profile`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-card">
      <h2>Reset your password</h2>
      <p>Enter your email and we&apos;ll send a reset link.</p>

      {error && <div className="login-error">{error}</div>}
      {sent ? (
        <div className="login-success">
          If an account exists for that email, a password reset link is on its
          way.
        </div>
      ) : (
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
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <div className="login-links">
        <Link href="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
