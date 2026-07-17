"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeSponsorOnboarding } from "./actions";
import { PASSWORD_HINT, checkPassword } from "@/lib/password";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function SponsorOnboardingForm({
  tierLabel,
  initialBusinessName,
  needsPassword,
}: {
  tierLabel: string;
  initialBusinessName: string;
  needsPassword: boolean;
}) {
  const router = useRouter();
  const [business, setBusiness] = useState({
    businessName: initialBusinessName,
    tagline: "",
    description: "",
    website: "",
    offer: "",
  });
  const [rep, setRep] = useState({ repName: "", repTitle: "", repPhone: "" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await completeSponsorOnboarding({ ...business, ...rep });
      if (!res.ok) {
        setError(res.message ?? "Something went wrong — try again.");
        return;
      }
      router.replace("/sponsors");
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

  return (
    <div className="login-card" style={{ textAlign: "left" }}>
      <h2>Welcome, sponsor</h2>
      <p>
        You&apos;re joining as a <strong>{tierLabel}</strong>. Tell us about
        the business (this becomes your listing on the members&apos; Sponsors
        page) and about you — you&apos;ll get full Momentum+ Pro access as
        the sponsor representative.
      </p>
      {error && <div className="login-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="login-field">
          <label htmlFor="sp-name">Business name</label>
          <input
            id="sp-name"
            required
            value={business.businessName}
            onChange={(e) =>
              setBusiness({ ...business, businessName: e.target.value })
            }
            placeholder="Acme Leadership Co."
          />
        </div>
        <div className="login-field">
          <label htmlFor="sp-tagline">One-line description</label>
          <input
            id="sp-tagline"
            value={business.tagline}
            onChange={(e) =>
              setBusiness({ ...business, tagline: e.target.value })
            }
            placeholder="What the business does, in a sentence"
          />
        </div>
        <div className="login-field">
          <label htmlFor="sp-description">
            About the business (your full profile page)
          </label>
          <textarea
            id="sp-description"
            rows={4}
            value={business.description}
            onChange={(e) =>
              setBusiness({ ...business, description: e.target.value })
            }
            placeholder="A few sentences about what you do, who you serve, and why members should know you."
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
        <div className="login-field">
          <label htmlFor="sp-website">Website</label>
          <input
            id="sp-website"
            type="url"
            value={business.website}
            onChange={(e) =>
              setBusiness({ ...business, website: e.target.value })
            }
            placeholder="https://…"
          />
        </div>
        <div className="login-field">
          <label htmlFor="sp-offer">Member offer (optional)</label>
          <input
            id="sp-offer"
            value={business.offer}
            onChange={(e) => setBusiness({ ...business, offer: e.target.value })}
            placeholder="e.g. Free consultation for Momentum+ members"
          />
        </div>

        <div className="login-field">
          <label htmlFor="sp-rep-name">Your name</label>
          <input
            id="sp-rep-name"
            required
            autoComplete="name"
            value={rep.repName}
            onChange={(e) => setRep({ ...rep, repName: e.target.value })}
            placeholder="First and last name"
          />
        </div>
        <div className="login-field">
          <label htmlFor="sp-rep-title">Your title / role</label>
          <input
            id="sp-rep-title"
            value={rep.repTitle}
            onChange={(e) => setRep({ ...rep, repTitle: e.target.value })}
            placeholder="Owner, Marketing Director, …"
          />
        </div>
        <div className="login-field">
          <label htmlFor="sp-rep-phone">Your phone (optional)</label>
          <input
            id="sp-rep-phone"
            autoComplete="tel"
            value={rep.repPhone}
            onChange={(e) => setRep({ ...rep, repPhone: e.target.value })}
            placeholder="+1 (555) 555-5555"
          />
        </div>

        {needsPassword && (
          <>
            <div className="login-field">
              <label htmlFor="sp-password">Choose a password</label>
              <input
                id="sp-password"
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
              <label htmlFor="sp-confirm">Confirm password</label>
              <input
                id="sp-confirm"
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
          {loading ? "Setting up…" : "Finish setup — enter Momentum+"}
        </button>
        <p style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 10 }}>
          Sponsorships run through October 1. Your listing can be polished
          anytime — logo and edits are handled with the Momentum+ team.
        </p>
      </form>
    </div>
  );
}
