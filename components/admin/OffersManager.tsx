"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectableBadges } from "@/lib/badges";
import { tierLabel } from "@/lib/access";
import type { Tier } from "@/lib/types";
import {
  listOffers,
  saveOffer,
  setOfferActive,
  type AdminOffer,
} from "@/app/(portal)/admin/announcements/offer-actions";
import { badgeSegments, type BadgeSegment } from "@/app/(portal)/admin/announcements/actions";
import { formatAt } from "@/lib/time-format";

/*
 * Targeted offers (Matt, 2026-08-19: "offer special deals to people who hold
 * specific badges"). A member holding a selected badge — or a selected tier —
 * sees this on their dashboard until they act on it, dismiss it, or it ends.
 *
 * Deliberately NOT a pricing tool. The admin writes the copy and pastes a
 * link (a Stripe payment link, a GHL funnel); the app never mints a discount
 * or stores an amount, so nothing here can disagree with the real prices.
 */

const TIER_OPTIONS: Tier[] = ["basic", "pro", "vip", "gift", "sponsor", "speaker"];

const BADGE_GROUPS = selectableBadges().reduce(
  (acc, b) => {
    const found = acc.find((g) => g.group === b.group);
    if (found) found.items.push(b);
    else acc.push({ group: b.group, items: [b] });
    return acc;
  },
  [] as { group: string; items: { key: string; label: string }[] }[],
);

export function OffersManager() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offers, setOffers] = useState<AdminOffer[] | null>(null);
  const [segments, setSegments] = useState<BadgeSegment[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({
    title: "",
    body: "",
    ctaLabel: "",
    ctaUrl: "",
    endsAt: "",
  });
  const [badges, setBadges] = useState<string[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);

  useEffect(() => {
    void (async () => {
      const [rows, segs] = await Promise.all([listOffers(), badgeSegments()]);
      setOffers(rows);
      setSegments(segs);
    })();
  }, []);

  const reach = (() => {
    // A rough size, and honest about it: a member holding two selected
    // badges is one person, but this cannot dedupe them without a query.
    const n = badges.reduce(
      (sum, k) => sum + (segments.find((s) => s.key === k)?.holders ?? 0),
      0,
    );
    return n;
  })();

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginTop: 20 }}>
      <div className="admin-field" style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 13 }}>Offers</label>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", margin: "0 0 12px" }}>
        A deal shown on the dashboard to members holding a badge or tier you
        pick. You write the copy and paste the link — a Stripe payment link,
        a GHL funnel, a form — so nothing here has to know your prices.
        Members can dismiss it, and it disappears on its end date.
      </p>

      {offers && offers.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {offers.map((o) => (
            <div
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 0",
                borderTop: "1px solid var(--border)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 13, minWidth: 0 }}>
                <strong>{o.title}</strong>
                <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                  {[...o.audienceBadges, ...o.audienceTiers].length} audience
                  {o.endsAt
                    ? ` · ends ${formatAt(o.endsAt, "monthDay")}`
                    : " · no end date"}
                  {o.active ? "" : " · off"}
                </div>
              </div>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await setOfferActive(o.id, !o.active);
                    setMsg({ ok: res.ok, text: res.message });
                    if (res.ok) {
                      setOffers(await listOffers());
                      router.refresh();
                    }
                  });
                }}
              >
                {o.active ? "Switch off" : "Switch on"}
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn-mini" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "New offer"}
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div className="admin-field">
            <label htmlFor="offer-title">Title</label>
            <input
              id="offer-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Founding Member rate — locked for a year"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="offer-body">One line of detail</label>
            <input
              id="offer-body"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Because you were here from the start."
            />
          </div>
          <div className="admin-field-row" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
            <div className="admin-field">
              <label htmlFor="offer-cta">Button label</label>
              <input
                id="offer-cta"
                value={form.ctaLabel}
                onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
                placeholder="Claim it"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="offer-url">Button link</label>
              <input
                id="offer-url"
                value={form.ctaUrl}
                onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })}
                placeholder="https://buy.stripe.com/…"
              />
            </div>
          </div>
          <div className="admin-field">
            <label htmlFor="offer-ends">Ends (optional)</label>
            <input
              id="offer-ends"
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </div>

          <div className="admin-field">
            <label>Who sees it — badges</label>
            {BADGE_GROUPS.map((g) => (
              <div key={g.group} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--ink-secondary)",
                    marginBottom: 6,
                  }}
                >
                  {g.group}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {g.items.map((b) => {
                    const holders = segments.find((s) => s.key === b.key)?.holders;
                    return (
                      <button
                        type="button"
                        key={b.key}
                        className={`tier-chip${badges.includes(b.key) ? " selected" : ""}`}
                        onClick={() =>
                          setBadges((prev) =>
                            prev.includes(b.key)
                              ? prev.filter((x) => x !== b.key)
                              : [...prev, b.key],
                          )
                        }
                      >
                        {b.label}
                        {holders !== undefined && (
                          <span style={{ opacity: 0.7 }}> · {holders}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="admin-field">
            <label>…and tiers</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TIER_OPTIONS.map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`tier-chip${tiers.includes(t) ? " selected" : ""}`}
                  onClick={() =>
                    setTiers((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                    )
                  }
                >
                  {tierLabel(t)}
                </button>
              ))}
            </div>
          </div>

          {badges.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
              Roughly {reach} badge holder{reach === 1 ? "" : "s"} (someone
              holding two selected badges is counted twice), plus anyone in the
              selected tiers.
            </p>
          )}

          <button
            type="button"
            className="btn-gold"
            disabled={pending}
            onClick={() => {
              setMsg(null);
              startTransition(async () => {
                const res = await saveOffer({
                  ...form,
                  audienceBadges: badges,
                  audienceTiers: tiers,
                });
                setMsg({ ok: res.ok, text: res.message });
                if (res.ok) {
                  setForm({ title: "", body: "", ctaLabel: "", ctaUrl: "", endsAt: "" });
                  setBadges([]);
                  setTiers([]);
                  setOpen(false);
                  setOffers(await listOffers());
                  router.refresh();
                }
              });
            }}
          >
            {pending ? "Saving…" : "Make it live"}
          </button>
        </div>
      )}

      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginTop: 10 }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
