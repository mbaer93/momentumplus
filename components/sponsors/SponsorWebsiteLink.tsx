"use client";

import { ExternalIcon } from "@/components/icons";

/**
 * Sponsor "Visit website" link that logs a sponsor click (sponsor_events)
 * before the browser follows the link — this feeds the Analytics report
 * sponsors see value in. sendBeacon survives the navigation.
 */
export function SponsorWebsiteLink({
  sponsorId,
  href,
  label = "Visit website",
}: {
  sponsorId: string;
  href: string;
  label?: string;
}) {
  function track() {
    const payload = JSON.stringify({ kind: "click", sponsorIds: [sponsorId] });
    try {
      if (!navigator.sendBeacon?.("/api/sponsors/track", payload)) {
        void fetch("/api/sponsors/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      // Tracking must never block the visit.
    }
  }

  return (
    <a
      className="sp-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={track}
    >
      {label} <ExternalIcon size={12} />
    </a>
  );
}
