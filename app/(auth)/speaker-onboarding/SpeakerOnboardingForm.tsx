"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeSpeakerOnboarding } from "./actions";
import { PASSWORD_HINT, checkPassword } from "@/lib/password";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function SpeakerOnboardingForm({
  initialName,
  needsPassword,
}: {
  initialName: string;
  needsPassword: boolean;
}) {
  const router = useRouter();
  // Prefill first/last from the invite's display name (split on the first
  // space) — both are required before the speaker gets access.
  const [initFirst = "", ...initRest] = initialName.trim().split(/\s+/);
  const [form, setForm] = useState({
    firstName: initFirst,
    lastName: initRest.join(" "),
    speakerTitle: "",
    bio: "",
    industries: "",
    businessName: "",
    businessDescription: "",
    businessUrl: "",
    repPhone: "",
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Setup finished but with notes worth reading — shown on a success panel
      instead of a silent redirect. */
  const [doneNotes, setDoneNotes] = useState<string[] | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm({ ...form, [key]: value });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsPassword) {
      const policyError = checkPassword(password);
      if (policyError) {
        setError(policyError);
        return;
      }
      if (password !== confirm) {
        setError("Those passwords don't match.");
        return;
      }
    }
    setLoading(true);
    try {
      if (needsPassword && isSupabaseConfigured()) {
        const supabase = createClient();
        const { error: pwError } = await supabase.auth.updateUser({ password });
        if (pwError) throw pwError;
      }
      const res = await completeSpeakerOnboarding({
        ...form,
        displayName:
          `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      });
      if (!res.ok) {
        setError(res.message ?? "Something went wrong — try again.");
        return;
      }
      // Partial failures (resource/profile writes) are shown, not hidden
      // behind the redirect.
      if (res.warnings && res.warnings.length > 0) {
        setDoneNotes(res.warnings);
        return;
      }
      router.replace("/speaker");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong — check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (doneNotes) {
    return (
      <div className="login-card" style={{ textAlign: "left" }}>
        <h2>Your speaker page is set up</h2>
        <p>A couple of things to know before you head in:</p>
        <ul style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 16px 18px" }}>
          {doneNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-gold"
          style={{ width: "100%" }}
          onClick={() => router.replace("/speaker")}
        >
          Open your Speaker Studio
        </button>
      </div>
    );
  }

  return (
    <div className="login-card" style={{ textAlign: "left" }}>
      <h2>Welcome, speaker</h2>
      <p>
        Three quick sections: your public speaker page, your business (shared
        with members as a resource), and your own details. You&apos;ll get
        full speaker access, plus the Speaker Studio to manage your sessions.
      </p>
      {error && <div className="login-error">{error}</div>}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="login-field">
            <label htmlFor="sk-first">First name</label>
            <input
              id="sk-first"
              required
              autoComplete="given-name"
              value={form.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div className="login-field">
            <label htmlFor="sk-last">Last name</label>
            <input
              id="sk-last"
              required
              autoComplete="family-name"
              value={form.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              placeholder="Rivers"
            />
          </div>
        </div>
        <div className="login-field">
          <label htmlFor="sk-title">Professional title</label>
          <input
            id="sk-title"
            value={form.speakerTitle}
            onChange={(e) => set("speakerTitle", e.target.value)}
            placeholder="e.g. Leadership Coach & Author"
          />
        </div>
        <div className="login-field">
          <label htmlFor="sk-bio">Bio</label>
          <textarea
            id="sk-bio"
            rows={4}
            value={form.bio}
            onChange={(e) => set("bio", e.target.value)}
            placeholder="A few sentences members will see on your speaker page"
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
        <div className="login-field">
          <label htmlFor="sk-industries">Topics / industries (comma-separated)</label>
          <input
            id="sk-industries"
            value={form.industries}
            onChange={(e) => set("industries", e.target.value)}
            placeholder="Leadership, Wellness, Finance"
          />
        </div>

        <div className="login-field">
          <label htmlFor="sk-biz">Your business (optional — shared as a member resource)</label>
          <input
            id="sk-biz"
            value={form.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            placeholder="Business or product name"
          />
        </div>
        {form.businessName.trim() && (
          <>
            <div className="login-field">
              <label htmlFor="sk-biz-desc">What should members know about it?</label>
              <textarea
                id="sk-biz-desc"
                rows={3}
                value={form.businessDescription}
                onChange={(e) => set("businessDescription", e.target.value)}
                placeholder="A sentence or two about the business, product, or service"
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
            <div className="login-field">
              <label htmlFor="sk-biz-url">Link</label>
              <input
                id="sk-biz-url"
                type="url"
                value={form.businessUrl}
                onChange={(e) => set("businessUrl", e.target.value)}
                placeholder="https://…"
              />
            </div>
          </>
        )}

        <div className="login-field">
          <label htmlFor="sk-phone">Your phone (optional)</label>
          <input
            id="sk-phone"
            autoComplete="tel"
            value={form.repPhone}
            onChange={(e) => set("repPhone", e.target.value)}
            placeholder="+1 (555) 555-5555"
          />
        </div>

        {needsPassword && (
          <>
            <div className="login-field">
              <label htmlFor="sk-password">Choose a password</label>
              <input
                id="sk-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 4 }}>
                {PASSWORD_HINT} Your username is your email address.
              </p>
            </div>
            <div className="login-field">
              <label htmlFor="sk-confirm">Confirm password</label>
              <input
                id="sk-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </>
        )}

        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? "Setting up…" : "Finish setup — open my Speaker Studio"}
        </button>
        <p style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 10 }}>
          Speaker access runs through October 1 of next year. Everything here
          can be edited later in your Speaker Studio.
        </p>
      </form>
    </div>
  );
}
