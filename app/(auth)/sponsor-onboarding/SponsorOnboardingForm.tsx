"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeSponsorOnboarding } from "./actions";
import { uploadOwnSponsorImage } from "@/app/(portal)/sponsor/actions";
import { PASSWORD_HINT, checkPassword } from "@/lib/password";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function SponsorOnboardingForm({
  tierLabel,
  initialBusinessName,
  initialTagline = "",
  initialDescription = "",
  initialWebsite = "",
  needsPassword,
  ticketAllotment = 0,
  adEligible = false,
}: {
  tierLabel: string;
  initialBusinessName: string;
  /** Prefill pushed from TSLS so the rep confirms rather than retypes. */
  initialTagline?: string;
  initialDescription?: string;
  initialWebsite?: string;
  needsPassword: boolean;
  /** Free VIP access tickets included with this sponsor tier. */
  ticketAllotment?: number;
  /** Rail-ad tiers only (Matt, 2026-07-20): lower tiers don't see an ad
      upload for artwork that would never be shown anywhere. */
  adEligible?: boolean;
}) {
  const router = useRouter();
  const [business, setBusiness] = useState({
    businessName: initialBusinessName,
    tagline: initialTagline,
    description: initialDescription,
    website: initialWebsite,
    offer: "",
  });
  const [rep, setRep] = useState({
    repFirst: "",
    repLast: "",
    repTitle: "",
    repPhone: "",
  });
  const [ticketEmails, setTicketEmails] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [adFile, setAdFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Setup finished but with notes worth reading (failed VIP invites or
      uploads) — shown on a success panel instead of a silent redirect. */
  const [doneNotes, setDoneNotes] = useState<string[] | null>(null);

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
      const res = await completeSponsorOnboarding({
        ...business,
        repTitle: rep.repTitle,
        repPhone: rep.repPhone,
        repName: `${rep.repFirst.trim()} ${rep.repLast.trim()}`.trim(),
        ticketEmails,
      });
      if (!res.ok) {
        setError(res.message ?? "Something went wrong — try again.");
        return;
      }
      // Anything that partially failed is COLLECTED and shown, not
      // swallowed: a mistyped VIP email or a failed logo upload used to
      // vanish behind the redirect, leaving the rep sure it all worked.
      const notes: string[] = [];
      if (res.message) notes.push(res.message);
      // Artwork rides along with setup: the rep is seated as owner by the
      // completion above, so the studio upload action authorizes them. A
      // failed upload never blocks onboarding — they can retry in the
      // Studio.
      if (res.sponsorId) {
        for (const [file, kind, label] of [
          [logoFile, "logo", "logo"],
          [adFile, "ad", "ad artwork"],
        ] as const) {
          if (file) {
            try {
              const fd = new FormData();
              fd.append("file", file);
              const up = await uploadOwnSponsorImage(res.sponsorId, kind, fd);
              if (!up.ok) {
                notes.push(
                  `Your ${label} didn't upload (${up.message ?? "unknown error"}) — retry it from your Sponsor Studio.`,
                );
              }
            } catch {
              notes.push(
                `Your ${label} didn't upload — retry it from your Sponsor Studio.`,
              );
            }
          }
        }
      }
      if (notes.length > 0) {
        setDoneNotes(notes);
        return;
      }
      // Land in the new Sponsor Studio — it shows the page, team, and
      // remaining VIP tickets they just set up.
      router.replace("/sponsor");
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
        <h2>Your sponsor page is set up</h2>
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
          onClick={() => router.replace("/sponsor")}
        >
          Open your Sponsor Studio
        </button>
      </div>
    );
  }

  return (
    <div className="login-card" style={{ textAlign: "left" }}>
      <h2>Welcome, sponsor</h2>
      <p>
        You&apos;re joining as a <strong>{tierLabel}</strong>. Tell us about
        the business (this becomes your listing on the members&apos; Sponsors
        page) and about you — as the page&apos;s primary manager you get the
        sponsorship&apos;s free Momentum+ membership for the season.
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
          <label htmlFor="sp-logo">
            Your logo (PNG/JPG/SVG/WebP, under 2 MB)
          </label>
          <input
            id="sp-logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
          />
        </div>
        {adEligible && (
          <div className="login-field">
            <label htmlFor="sp-ad">
              Ad artwork (optional — your tier includes member-page ad
              placements, activated by the Momentum+ team; PNG/JPG/SVG/WebP,
              under 2 MB)
            </label>
            <input
              id="sp-ad"
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={(e) => setAdFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="login-field">
            <label htmlFor="sp-rep-first">First name</label>
            <input
              id="sp-rep-first"
              required
              autoComplete="given-name"
              value={rep.repFirst}
              onChange={(e) => setRep({ ...rep, repFirst: e.target.value })}
              placeholder="Jane"
            />
          </div>
          <div className="login-field">
            <label htmlFor="sp-rep-last">Last name</label>
            <input
              id="sp-rep-last"
              required
              autoComplete="family-name"
              value={rep.repLast}
              onChange={(e) => setRep({ ...rep, repLast: e.target.value })}
              placeholder="Rivers"
            />
          </div>
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

        {ticketAllotment > 0 && (
          <div className="login-field">
            <label htmlFor="sp-tickets">
              VIP access tickets ({ticketAllotment} included)
            </label>
            <textarea
              id="sp-tickets"
              rows={3}
              value={ticketEmails}
              onChange={(e) => setTicketEmails(e.target.value)}
              placeholder={"one@example.com\ntwo@example.com"}
              style={{ width: "100%", resize: "vertical" }}
            />
            <p style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 4 }}>
              Your {tierLabel} package includes {ticketAllotment} free VIP
              access ticket{ticketAllotment === 1 ? "" : "s"} (3 months each).
              Add one email per person — each gets an invite to set up their
              own profile. You can also do this later from your Sponsor
              Studio.
            </p>
          </div>
        )}

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
