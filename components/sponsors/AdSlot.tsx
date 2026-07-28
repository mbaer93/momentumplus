import Link from "next/link";
import { hydratedAdsFor } from "@/lib/ads";
import type { AdCreative } from "@/lib/ads-shared";

/*
 * Renders whatever the Ad Manager has put in a named slot, in the order set
 * there. Live-only: RLS hides switched-off and out-of-flight creatives, and
 * adsFor() re-checks the dates so a page cached either side of a start time
 * can't show one early.
 *
 * Sponsor-linked creatives carry data-sponsor-id, which the existing
 * impression tracker picks up — the same pipeline the rail already uses, so
 * these show up in Admin → Analytics without a second reporting path.
 */
export async function AdSlot({
  placement,
  /** Cap for slots that sit inside a scrolling list. */
  limit,
}: {
  placement: string;
  limit?: number;
}) {
  const all = await hydratedAdsFor(placement);
  const ads = typeof limit === "number" ? all.slice(0, limit) : all;
  if (ads.length === 0) return null;
  return <AdItems ads={ads} />;
}

/** The slot's markup on its own, for callers that already have the rows. */
export function AdItems({ ads }: { ads: AdCreative[] }) {
  if (ads.length === 0) return null;
  return (
    <div className="ad-slot">
      {ads.map((ad) => {
        const inner = (
          <>
            {ad.imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="ad-slot-image" src={ad.imageUrl} alt="" />
            )}
            <div className="ad-slot-copy">
              <div className="ad-slot-title">{ad.title}</div>
              {ad.body && <div className="ad-slot-body">{ad.body}</div>}
            </div>
            {ad.url && ad.ctaLabel && (
              <span className="ad-slot-cta">{ad.ctaLabel}</span>
            )}
          </>
        );

        const className = `ad-slot-item${ad.kind === "notice" ? " notice" : ""}`;
        // A notice with no link is copy, not a target — don't make it look
        // clickable when nothing happens on tap.
        if (!ad.url) {
          return (
            <div key={ad.id} className={className} data-sponsor-id={ad.sponsorId ?? undefined}>
              {inner}
            </div>
          );
        }
        const external = /^https?:\/\//i.test(ad.url);
        return external ? (
          <a
            key={ad.id}
            className={className}
            href={ad.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            data-sponsor-id={ad.sponsorId ?? undefined}
          >
            {inner}
          </a>
        ) : (
          <Link
            key={ad.id}
            className={className}
            href={ad.url}
            data-sponsor-id={ad.sponsorId ?? undefined}
          >
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
