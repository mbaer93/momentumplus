"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/app/(portal)/profile/actions";
import { PASSWORD_HINT, checkPassword } from "@/lib/password";
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
  mode = "welcome",
  startAtProfile = false,
}: {
  initialProfile: WelcomeInitialProfile;
  email: string;
  /** "reset" = an existing member changing a forgotten password: no
      onboarding copy, no profile step — just the new password. */
  mode?: "welcome" | "reset";
  /** Jump straight to the profile step — used when a signed-in member
      (password already set) is missing their name. */
  startAtProfile?: boolean;
}) {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [step, setStep] = useState<1 | 2>(startAtProfile ? 2 : 1);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Start from the EXISTING profile — recovery-link visitors are members
  // with real data, and this form must never blank it out.
  const [existingFirst = "", ...existingRest] = initialProfile.full_name
    .trim()
    .split(/\s+/);
  const [profile, setProfile] = useState({
    first_name: existingFirst,
    last_name: existingRest.join(" "),
    company: initialProfile.company,
    title: initialProfile.title,
    phone: initialProfile.phone,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const policyError = checkPassword(password);
    if (policyError) {
      setError(policyError);
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
      if (mode === "reset") {
        // Existing member: password changed, straight back inside.
        router.replace("/dashboard");
        return;
      }
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
    if (!profile.first_name.trim() || !profile.last_name.trim()) {
      setError("Please enter both your first and last name — that's how members will know you.");
      return;
    }
    setLoading(true);
    try {
      const res = await updateProfile({
        full_name: `${profile.first_name.trim()} ${profile.last_name.trim()}`,
        phone: profile.phone,
        company: profile.company,
        title: profile.title,
        // Not shown in this quick walkthrough — pass through untouched so
        // finishing the wizard never erases what a member wrote before.
        industry: initialProfile.industry,
        bio: initialProfile.bio,
      });
      // A failed save used to silently drop everything the member typed —
      // keep them on the form and say so.
      if (res && res.ok === false) {
        if (/not signed in/i.test(res.message ?? "")) {
          router.replace("/login?redirect=/welcome");
          return;
        }
        setError(
          res.message ??
            "We couldn't save your profile — try again, or finish it later in Settings.",
        );
        return;
      }
      router.replace("/dashboard");
    } catch {
      setError(
        "We couldn't save your profile — check your connection and try again, or finish it later in Settings.",
      );
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="login-field">
              <label htmlFor="wf-first">First name</label>
              <input
                id="wf-first"
                required
                autoComplete="given-name"
                value={profile.first_name}
                onChange={(e) =>
                  setProfile({ ...profile, first_name: e.target.value })
                }
                placeholder="Jane"
              />
            </div>
            <div className="login-field">
              <label htmlFor="wf-last">Last name</label>
              <input
                id="wf-last"
                required
                autoComplete="family-name"
                value={profile.last_name}
                onChange={(e) =>
                  setProfile({ ...profile, last_name: e.target.value })
                }
                placeholder="Rivers"
              />
            </div>
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
      <h2>{mode === "reset" ? "Choose a new password" : "Welcome to Momentum+"}</h2>
      <p>
        {mode === "reset" ? (
          <>
            You&apos;re signed in — set a new password below and you&apos;re
            done. Your username is still your email address
            {email ? (
              <>
                {" "}
                (<strong>{email}</strong>)
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            You&apos;re in — two quick steps and you&apos;re set. First,
            choose a password. Your username is your email address
            {email ? (
              <>
                {" "}
                (<strong>{email}</strong>)
              </>
            ) : null}{" "}
            — you&apos;ll sign in with it and this password from now on.
          </>
        )}
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
            placeholder="Choose a strong password"
          />
          <p style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 4 }}>
            {PASSWORD_HINT}
          </p>
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
          {loading ? "Saving…" : mode === "reset" ? "Save new password" : "Continue"}
        </button>
      </form>
    </div>
  );
}
