import { listSponsors } from "@/lib/directory-queries";
import { BodyAdClient } from "./BodyAdClient";

/*
 * In-body sponsor placement (Matt, 2026-07-18): 1-2 ads inside the main
 * content of portal pages, reserved for the Momentum+ Sponsor and the
 * Title Sponsor. Pages choose the size that fits their layout:
 *   - "banner": full-width horizontal strip (dashboard, lists)
 *   - "tile":   compact card for grid pages
 * Impressions/clicks reuse the sponsor_events pipeline, so these show up
 * in Admin → Analytics alongside the rail numbers.
 */
export async function BodyAd({
  variant,
}: {
  variant: "banner" | "tile";
}) {
  const sponsors = (await listSponsors()).filter(
    (s) => s.tier === "momentum_plus" || s.tier === "title",
  );
  if (sponsors.length === 0) return null;
  return (
    <BodyAdClient
      variant={variant}
      sponsors={sponsors.slice(0, 2).map((s) => ({
        id: s.id,
        name: s.name,
        tagline: s.tagline,
        offer: s.offer,
        logoUrl: s.logoUrl,
        sidebarAdUrl: s.sidebarAdUrl,
        wordmark: s.wordmark,
      }))}
    />
  );
}
