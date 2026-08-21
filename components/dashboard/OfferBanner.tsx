"use client";

import { useState, useTransition } from "react";
import { dismissOffer } from "@/app/(portal)/dashboard/offer-actions";
import type { MemberOffer } from "@/lib/offers";
import { formatAt } from "@/lib/time-format";

/*
 * A targeted offer, on the dashboard (Matt, 2026-08-19).
 *
 * One at a time, dismissible, and quiet: this sits on a member's own home
 * screen, so it reads as something they earned rather than an advert. The
 * gold rule of the whole badge feature is that a badge is a reward — an
 * offer bolted to it has to feel like the reward continuing, not a bill
 * arriving.
 *
 * Which offer this is was decided in the database. The component never
 * evaluates an audience.
 */

function endsLabel(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  if (days <= 14) return `Ends in ${days} days`;
  return `Ends ${formatAt(iso, "monthDay")}`;
}

export function OfferBanner({ offer }: { offer: MemberOffer }) {
  const [closed, setClosed] = useState(false);
  const [, startTransition] = useTransition();
  if (closed) return null;

  return (
    <div
      style={{
        border: "1px solid var(--gold)",
        background: "rgba(184, 150, 90, 0.08)",
        borderRadius: 4,
        padding: "14px 16px",
        margin: "0 0 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15 }}>{offer.title}</strong>
          {offer.endsAt && (
            <span style={{ fontSize: 11.5, color: "var(--ink-secondary)" }}>
              {endsLabel(offer.endsAt)}
            </span>
          )}
        </div>
        {offer.body && (
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-secondary)",
              margin: "4px 0 0",
              lineHeight: 1.5,
            }}
          >
            {offer.body}
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {offer.ctaUrl && (
          <a
            className="btn-gold"
            href={offer.ctaUrl}
            /* Offers point at Stripe links and GHL funnels — off-site, so
               opened in a new tab and denied any handle back to this one. */
            target="_blank"
            rel="noopener noreferrer"
          >
            {offer.ctaLabel || "See the details"}
          </a>
        )}
        <button
          type="button"
          className="btn-ghost"
          aria-label="Dismiss this offer"
          onClick={() => {
            // Hidden immediately; the row is written in the background. A
            // dismiss that appears to do nothing for a second reads as broken.
            setClosed(true);
            startTransition(async () => {
              await dismissOffer(offer.id);
            });
          }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
