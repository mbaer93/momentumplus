"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeSpeakerOnboarding } from "./actions";
import { checkPassword } from "@/lib/password";
import { PasswordField } from "@/components/PasswordField";
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
  /** Non-null once setup succeeded — switches the card to the thank-you and
      orientation screen. The array holds any partial-failure notes, and is
      usually empty; an empty array still means "done", not "not yet". */
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
      // Always the thank-you screen, warnings or not. Partial failures
      // (resource/profile writes) appear on it rather than being hidden
      // behind a redirect.
      setDoneNotes(res.warnings ?? []);
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

  /*
   * Every completed setup lands here, not just the ones with warnings
   * (Matt, 2026-08-14). A silent redirect into the Studio dropped a new
   * speaker into a tool they had never seen, with no idea what it was for
   * or where anything else lived.
   */
  if (doneNotes) {
    return (
      <div className="login-card" style={{ textAlign: "left" }}>
        <h2>Thank you — you&apos;re set up</h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          Your speaker page is live in the member directory, your business is
          published as a member resource, and you have full access through the
          season.
        </p>

        {doneNotes.length > 0 && (
          <>
            <p style={{ fontSize: 13.5, marginBottom: 6 }}>
              Two things didn&apos;t save — you can fix both from the Studio:
            </p>
            <ul
              style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 16px 18px" }}
            >
              {doneNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ fontSize: 15, margin: "18px 0 6px" }}>
          Your Speaker Studio
        </h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 8px" }}>
          Everything you control lives there — it&apos;s the Speaker Studio
          link in the left-hand menu:
        </p>
        <ul style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 16px 18px" }}>
          <li>Edit your speaker page, headshot, bio and topics</li>
          <li>Edit your business resource page</li>
          <li>
            For each session you&apos;re presenting: start the Zoom room as
            host, see who&apos;s enrolled, email them, and attach handouts
          </li>
        </ul>

        <h3 style={{ fontSize: 15, margin: "18px 0 6px" }}>
          The rest of Momentum+
        </h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 16px" }}>
          You have the same access as a Pro member: Sessions to enrol in
          anything you&apos;d like to attend, the Library of past recordings,
          Community for the member chat, and Calendar for what&apos;s coming
          up. Your own details are under My Profile.
        </p>

        {/* The agreement gate fires on the way into the Studio. Saying so
            here turns a surprise redirect into an expected next step. */}
        <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 16px" }}>
          One more step for most speakers: the Leadership Advisor Agreement.
          If it applies to you, the next screen will be the agreement to read
          and sign — the Studio opens once that&apos;s done.
        </p>

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
      {/* Rob, via Matt, 2026-08-19: "it does not have indicators for
          required fields until you press the save button." Every field here
          is required, so one sentence up front beats an asterisk on each
          label — the asterisks would carry no information, since none of
          them distinguishes anything from anything. */}
      <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginTop: -6 }}>
        Everything below is required — it all appears on your speaker page,
        and you can edit any of it later in your Studio.
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
            required
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
            required
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
            required
            value={form.industries}
            onChange={(e) => set("industries", e.target.value)}
            placeholder="Leadership, Wellness, Finance"
          />
        </div>

        <div className="login-field">
          <label htmlFor="sk-biz">Your business (shared as a member resource)</label>
          <input
            id="sk-biz"
            required
            value={form.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            placeholder="Business or product name"
          />
        </div>
        {/* Always shown. These used to appear only once a business name was
            typed, which was fine when the whole section was optional — now
            that it is required, hiding two required fields behind a third is
            a form you cannot submit and cannot see why. */}
        <div className="login-field">
          <label htmlFor="sk-biz-desc">What should members know about it?</label>
          <textarea
            id="sk-biz-desc"
            rows={3}
            required
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
            required
            value={form.businessUrl}
            onChange={(e) => set("businessUrl", e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div className="login-field">
          <label htmlFor="sk-phone">Your phone</label>
          <input
            id="sk-phone"
            required
            autoComplete="tel"
            value={form.repPhone}
            onChange={(e) => set("repPhone", e.target.value)}
            placeholder="+1 (555) 555-5555"
          />
        </div>

        {needsPassword && (
          <>
            <PasswordField
              id="sk-password"
              label="Choose a password"
              value={password}
              onChange={setPassword}
              required
            />
            <p style={{ fontSize: 12, color: "var(--mid-gray)", margin: "-4px 0 0" }}>
              Your username is your email address.
            </p>
            <PasswordField
              id="sk-confirm"
              label="Confirm password"
              value={confirm}
              onChange={setConfirm}
              showRules={false}
              mustMatch={password}
              required
            />
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
