"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/app/(portal)/profile/actions";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * First-login walkthrough for invited members:
 *   Step 1 — set a password (they arrived signed-in from the invite email)
 *   Step 2 — complete their member profile (name, company, role, phone)
 * then straight into the portal.
 */
export interface WelcomeInitialProfile {
  full_name: string;
  company: string;
  title: string;
  phone: string;
  industry: string;
  bio: string;
}

export function WelcomeForm({
  initialProfile,
  email,
}: {
  initialProfile: WelcomeInitialProfile;
  email: string;
}) {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Start from the EXISTING profile — recovery-link visitors are members
  // with real data, and this form must never blank it out.
  const [profile, setProfile] = useState({
    full_name: initialProfile.full_name,
    company: initialProfile.company,
    title: initialProfile.title,
    phone: initialProfile.phone,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePassword(e: React.FormEvent) {
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
      setStep(2);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStep(2);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save that password — try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!profile.full_name.trim()) {
      setError("Tell us your name so members know who you are.");
      return;
    }
    setLoading(true);
    try {
      await updateProfile({
        full_name: profile.full_name,
        phone: profile.phone,
        company: profile.company,
        title: profile.title,
        // Not shown in this quick walkthrough — pass through untouched so
        // finishing the wizard never erases what a member wrote before.
        industry: initialProfile.industry,
        bio: initialProfile.bio,
      });
      router.replace("/dashboard");
    } catch {
      // Profile details can always be finished later in Settings.
      router.replace("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  if (step === 2) {
    return (
      <div className="login-card">
        <h2>Tell the community who you are</h2>
        <p>
          This appears on your member profile — you can change any of it later
          under Settings.
        </p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={saveProfile}>
          <div className="login-field">
            <label htmlFor="wf-name">Full name</label>
            <input
              id="wf-name"
              required
              value={profile.full_name}
              onChange={(e) =>
                setProfile({ ...profile, full_name: e.target.value })
              }
              placeholder="Jane Rivers"
            />
          </div>
          <div className="login-field">
            <label htmlFor="wf-company">Company</label>
            <input
              id="wf-company"
              value={profile.company}
              onChange={(e) =>
                setProfile({ ...profile, company: e.target.value })
              }
              placeholder="Rivers Consulting"
            />
          </div>
          <div className="login-field">
            <label htmlFor="wf-title">Title / role</label>
            <input
              id="wf-title"
              value={profile.title}
              onChange={(e) => setProfile({ ...profile, title: e.target.value })}
              placeholder="Founder & CEO"
            />
          </div>
          <div className="login-field">
            <label htmlFor="wf-phone">Phone (optional — for SMS reminders)</label>
            <input
              id="wf-phone"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+1 (555) 555-5555"
            />
          </div>
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Saving…" : "Finish — take me inside"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-card">
      <h2>Welcome to Momentum+</h2>
      <p>
        You&apos;re in — two quick steps and you&apos;re set. First, choose a
        password. Your username is your email address
        {email ? (
          <>
            {" "}
            (<strong>{email}</strong>)
          </>
        ) : null}
        — you&apos;ll sign in with it and this password from now on.
      </p>
      {error && <div className="login-error">{error}</div>}
      <form onSubmit={savePassword}>
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
          {loading ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
