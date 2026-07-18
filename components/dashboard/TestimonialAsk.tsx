"use client";

import { useEffect, useState, useTransition } from "react";
import { submitTestimonial } from "@/app/(portal)/dashboard/testimonial-actions";

const DISMISS_KEY = "mp-testimonial-dismissed";

/*
 * Dashboard ask: "how's your experience?" → a short testimonial form.
 * Dismissable (localStorage); disappears for good once they've submitted.
 * Approved quotes end up on the public landing page.
 */
export function TestimonialAsk({
  memberName,
  defaultRole,
}: {
  memberName: string;
  defaultRole: string;
}) {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState("");
  const [name, setName] = useState(memberName);
  const [roleCompany, setRoleCompany] = useState(defaultRole);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // fine — it just reappears next visit
    }
  }

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const res = await submitTestimonial({ quote, name, roleCompany });
      setMsg({ text: res.message ?? (res.ok ? "Thank you!" : "Error"), ok: res.ok });
      if (res.ok) {
        setDone(true);
        try {
          localStorage.setItem(DISMISS_KEY, "1");
        } catch {
          // fine
        }
      }
    });
  }

  return (
    <div className="card" style={{ marginTop: 18, padding: "16px 18px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "var(--gold)",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            How&apos;s Momentum+ working for you?
          </div>
          <div style={{ fontSize: 13, color: "var(--mid-gray)" }}>
            {done
              ? (msg?.text ?? "Thank you!")
              : "We'd love to hear it — and with your OK, share it with leaders deciding whether to join."}
          </div>
        </div>
        {!done && (
          <button
            type="button"
            className="btn-mini"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            Not now
          </button>
        )}
      </div>

      {!done && !open && (
        <button
          type="button"
          className="btn-gold"
          style={{ marginTop: 12, padding: "9px 16px", fontSize: 13 }}
          onClick={() => setOpen(true)}
        >
          Share your experience
        </button>
      )}

      {!done && open && (
        <div style={{ marginTop: 12 }}>
          <div className="admin-field">
            <label htmlFor="tst-quote">Your experience, in your words</label>
            <textarea
              id="tst-quote"
              rows={3}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="What has Momentum+ done for you or your leadership?"
            />
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="tst-name">Name to display</label>
              <input
                id="tst-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="tst-role">Title &amp; company (optional)</label>
              <input
                id="tst-role"
                value={roleCompany}
                onChange={(e) => setRoleCompany(e.target.value)}
                placeholder="e.g. Founder, Chen Creative"
              />
            </div>
          </div>
          <div className="admin-form-actions" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="btn-gold"
              style={{ padding: "9px 16px", fontSize: 13 }}
              disabled={pending}
              onClick={submit}
            >
              {pending ? "Sending…" : "Submit"}
            </button>
            <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
              The team reviews everything before it appears publicly.
            </span>
            {msg && !msg.ok && (
              <span className="admin-form-msg err">{msg.text}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
