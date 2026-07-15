"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function WelcomeForm() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    if (!configured) {
      router.replace("/dashboard");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't save that password — try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-card">
      <h2>Welcome to Momentum+</h2>
      <p>
        You&apos;re signed in. Set a password so you can log back in anytime
        with your email.
      </p>

      {error && <div className="login-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="login-field">
          <label htmlFor="password">Choose a password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>
        <div className="login-field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? "Saving…" : "Save & enter the portal"}
        </button>
      </form>
    </div>
  );
}
