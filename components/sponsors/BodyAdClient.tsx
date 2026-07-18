"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SponsorMark } from "./SponsorMark";

interface BodyAdSponsor {
  id: string;
  name: string;
  tagline: string;
  offer: string | null;
  logoUrl: string | null;
  sidebarAdUrl: string | null;
  wordmark: "newstalk" | "bank" | "summit" | "clarity" | "wellness" | "photo" | null;
}

/*
 * Renders the in-body placement and reports impressions (one batched POST
 * per page view) and clicks (sendBeacon) through the same
 * /api/sponsors/track pipeline as the right rail.
 */
export function BodyAdClient({
  sponsors,
  variant,
}: {
  sponsors: BodyAdSponsor[];
  variant: "banner" | "tile";
}) {
  const pathname = usePathname();
  const seenPath = useRef<string | null>(null);

  useEffect(() => {
    if (sponsors.length === 0) return;
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
  }, [pathname, sponsors]);

  if (sponsors.length === 0) return null;

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

  if (variant === "tile") {
    return (
      <div className="body-ad-row tiles">
        {sponsors.map((s) => (
          <Link
            key={s.id}
            href={`/sponsors/${s.id}`}
            className="body-ad-tile"
            onClick={() => trackClick(s.id)}
          >
            <span className="sponsor-ad-tag">Sponsored</span>
            <div className="body-ad-tile-mark">
              <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} />
            </div>
            <div className="body-ad-tile-name">{s.name}</div>
            {s.offer ? (
              <div className="sponsor-ad-offer">{s.offer}</div>
            ) : (
              <div className="body-ad-tagline">{s.tagline}</div>
            )}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="body-ad-row">
      {sponsors.map((s) => (
        <Link
          key={s.id}
          href={`/sponsors/${s.id}`}
          className="body-ad-banner"
          onClick={() => trackClick(s.id)}
        >
          <span className="sponsor-ad-tag">Sponsored</span>
          {s.sidebarAdUrl ? (
            <Image
              className="body-ad-creative"
              src={s.sidebarAdUrl}
              alt={`${s.name} — sponsor ad`}
              width={480}
              height={160}
              sizes="(max-width: 640px) 100vw, 480px"
            />
          ) : (
            <div className="body-ad-mark">
              <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} />
            </div>
          )}
          <div className="body-ad-body">
            <div className="body-ad-name">{s.name}</div>
            {s.tagline && <div className="body-ad-tagline">{s.tagline}</div>}
            {s.offer && <div className="sponsor-ad-offer">{s.offer}</div>}
          </div>
          <span className="body-ad-cta">Learn more</span>
        </Link>
      ))}
    </div>
  );
}
