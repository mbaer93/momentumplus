"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SponsorMark } from "./SponsorMark";
import type { SponsorItem } from "@/lib/directory-data";

/*
 * Right-rail sponsor ads (SPEC.md §5): renders on portal pages except
 * community and profile (and the live room / admin, where it would intrude).
 * Impressions are batched — one POST per page view for all visible cards;
 * clicks are sent individually via sendBeacon so navigation isn't blocked.
 *
 * What fills the rail comes from two places:
 *   - `ads`: rows the Ad Manager put in the "rail" slot. Sponsor-linked rows
 *     render as sponsor cards (leading the rail, in the manager's order);
 *     notices render as house cards at the foot — that's where the
 *     "Become a partner" card lives since migration 0057.
 *   - `sponsors`: top-tier sponsors with rail placement from Admin →
 *     Sponsors that have no ad row of their own.
 */

const HIDDEN_PREFIXES = ["/community", "/profile", "/admin", "/upgrade"];

function hiddenFor(pathname: string): boolean {
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return true;
  if (pathname.startsWith("/sessions/") && pathname.endsWith("/live")) return true;
  return false;
}

export interface RailAd {
  id: string;
  kind: "ad" | "notice";
  title: string;
  body: string;
  ctaLabel: string;
  url: string;
  imageUrl: string | null;
  sponsorId: string | null;
  sponsor: {
    name: string;
    tagline: string;
    offer: string | null;
    logoUrl: string | null;
    wordmark: SponsorItem["wordmark"];
  } | null;
}

export function SponsorRail({
  sponsors,
  ads = [],
  showUpgrade = false,
}: {
  sponsors: SponsorItem[];
  ads?: RailAd[];
  /** Member is below Pro — lead the rail with the upgrade card. */
  showUpgrade?: boolean;
}) {
  const pathname = usePathname();
  const hidden = hiddenFor(pathname);
  const seenPath = useRef<string | null>(null);

  const adCards = ads.filter((a) => a.kind === "ad" && a.sponsor);
  const notices = ads.filter((a) => a.kind === "notice" || !a.sponsor);
  const hasContent =
    sponsors.length > 0 || adCards.length > 0 || notices.length > 0;

  // Every sponsor visible in the rail, whichever system put it there.
  const impressionIds = Array.from(
    new Set([
      ...adCards.flatMap((a) => (a.sponsorId ? [a.sponsorId] : [])),
      ...sponsors.map((s) => s.id),
    ]),
  );

  // Batched impression per page view — only when the rail is actually
  // visible (CSS hides it below 1180px; counting there would overreport
  // to sponsors).
  useEffect(() => {
    if (hidden || impressionIds.length === 0) return;
    if (!window.matchMedia("(min-width: 1180px)").matches) return;
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    void fetch("/api/sponsors/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "impression", sponsorIds: impressionIds }),
      keepalive: true,
    }).catch(() => {});
    // impressionIds is derived from props; pathname is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hidden, ads, sponsors]);

  if (hidden || (!hasContent && !showUpgrade)) return null;

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

  function sponsorCard(
    key: string,
    href: string,
    onClick: (() => void) | undefined,
    creativeUrl: string | null,
    name: string,
    tagline: string,
    offer: string | null,
    logoUrl: string | null,
    wordmark: SponsorItem["wordmark"],
  ) {
    const inner = (
      <>
        <span className="sponsor-ad-tag">Sponsored</span>
        {creativeUrl ? (
          /* Uploaded ad creative replaces the logo/tagline block.
             next/image resizes the (up to 2 MB) original to ~200px. */
          <Image
            className="sponsor-ad-creative"
            src={creativeUrl}
            alt={`${name} — sponsor ad`}
            width={400}
            height={300}
            sizes="200px"
            style={{ width: "100%", height: "auto" }}
          />
        ) : (
          <div className="sponsor-ad-logo">
            <SponsorMark name={name} logoUrl={logoUrl} wordmark={wordmark} />
          </div>
        )}
        <div className="sponsor-ad-body">
          <div className="sponsor-ad-name">{name}</div>
          {!creativeUrl && <div className="sponsor-ad-tagline">{tagline}</div>}
          {offer && <div className="sponsor-ad-offer">{offer}</div>}
          <div className="sponsor-ad-link">Learn more</div>
        </div>
      </>
    );
    return /^https?:\/\//i.test(href) ? (
      <a
        key={key}
        className="sponsor-ad-card"
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={onClick}
      >
        {inner}
      </a>
    ) : (
      <Link key={key} className="sponsor-ad-card" href={href} onClick={onClick}>
        {inner}
      </Link>
    );
  }

  return (
    <aside className="sponsor-rail">
      {showUpgrade && (
        /* Upgrade path for members below Pro — straight to the plans page. */
        <Link href="/upgrade" className="rail-upgrade-card">
          <span className="rail-upgrade-kicker">Momentum+ Pro</span>
          <span className="rail-upgrade-title">Get the full experience</span>
          <span className="rail-upgrade-sub">
            Pro-only sessions, the complete recording library, and premium
            resources.
          </span>
          <span className="rail-upgrade-cta">Upgrade your membership</span>
        </Link>
      )}
      {(adCards.length > 0 || sponsors.length > 0) && (
        <div className="rail-label">Member Partners</div>
      )}
      {adCards.map((a) =>
        sponsorCard(
          a.id,
          a.url || (a.sponsorId ? `/sponsors/${a.sponsorId}` : "/sponsors"),
          a.sponsorId ? () => trackClick(a.sponsorId as string) : undefined,
          a.imageUrl,
          a.title || a.sponsor?.name || "",
          a.body || a.sponsor?.tagline || "",
          a.sponsor?.offer ?? null,
          a.sponsor?.logoUrl ?? null,
          a.sponsor?.wordmark ?? null,
        ),
      )}
      {sponsors.map((s) =>
        /* Rail cards lead to the sponsor's full profile page. */
        sponsorCard(
          s.id,
          `/sponsors/${s.id}`,
          () => trackClick(s.id),
          s.sidebarAdUrl,
          s.name,
          s.tagline,
          s.offer,
          s.logoUrl,
          s.wordmark,
        ),
      )}
      {notices.map((n) => (
        <div key={n.id} className="rail-become">
          <div className="rail-become-title">{n.title}</div>
          {n.body && <div className="rail-become-sub">{n.body}</div>}
          {n.url && n.ctaLabel && (
            <a
              className="btn-gold"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 12,
                padding: "9px 12px",
                fontSize: 12,
              }}
              href={n.url}
              {...(/^https?:\/\//i.test(n.url)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {n.ctaLabel}
            </a>
          )}
        </div>
      ))}
      {hasContent && (
        <Link href="/sponsors" className="rail-become-link">
          Meet our sponsors
        </Link>
      )}
    </aside>
  );
}
