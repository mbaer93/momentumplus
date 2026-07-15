"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SponsorMark } from "./SponsorMark";
import { SPONSOR_INTEREST_URL } from "@/lib/links";
import type { SponsorItem } from "@/lib/directory-data";

/*
 * Right-rail sponsor ads (SPEC.md §5): renders on portal pages except
 * community and profile (and the live room / admin, where it would intrude).
 * Impressions are batched — one POST per page view for all visible cards;
 * clicks are sent individually via sendBeacon so navigation isn't blocked.
 */

const HIDDEN_PREFIXES = ["/community", "/profile", "/admin"];

function hiddenFor(pathname: string): boolean {
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return true;
  if (pathname.startsWith("/sessions/") && pathname.endsWith("/live")) return true;
  return false;
}

export function SponsorRail({ sponsors }: { sponsors: SponsorItem[] }) {
  const pathname = usePathname();
  const hidden = hiddenFor(pathname);
  const seenPath = useRef<string | null>(null);

  // Batched impression per page view.
  useEffect(() => {
    if (hidden || sponsors.length === 0) return;
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    void fetch("/api/sponsors/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "impression",
        sponsorIds: sponsors.map((s) => s.id),
      }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname, hidden, sponsors]);

  if (hidden || sponsors.length === 0) return null;

  function trackClick(id: string) {
    const payload = JSON.stringify({ kind: "click", sponsorIds: [id] });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/sponsors/track",
        new Blob([payload], { type: "application/json" }),
      );
    } else {
      void fetch("/api/sponsors/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }

  return (
    <aside className="sponsor-rail">
      <div className="rail-label">Member Partners</div>
      {sponsors.map((s) => (
        <a
          key={s.id}
          className="sponsor-ad-card"
          href={s.website}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() => trackClick(s.id)}
        >
          <span className="sponsor-ad-tag">Sponsored</span>
          <div className="sponsor-ad-logo">
            <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} />
          </div>
          <div className="sponsor-ad-body">
            <div className="sponsor-ad-name">{s.name}</div>
            <div className="sponsor-ad-tagline">{s.tagline}</div>
            {s.offer && <div className="sponsor-ad-offer">{s.offer}</div>}
            <div className="sponsor-ad-link">Learn more</div>
          </div>
        </a>
      ))}
      <div className="rail-become">
        <div className="rail-become-title">Become a partner</div>
        <div className="rail-become-sub">
          Put your brand in front of the Tri-State&apos;s most engaged leaders.
        </div>
        <a
          className="btn-gold"
          style={{ display: "block", textAlign: "center", marginTop: 12, padding: "9px 12px", fontSize: 12 }}
          href={SPONSOR_INTEREST_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Become a Partner
        </a>
        <Link href="/sponsors" className="rail-become-link">
          Meet our sponsors
        </Link>
      </div>
    </aside>
  );
}
