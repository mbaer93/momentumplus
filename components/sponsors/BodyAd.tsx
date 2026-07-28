import { hydratedAdsFor } from "@/lib/ads";
import { AdItems } from "./AdSlot";
import { BodyAdClient } from "./BodyAdClient";

/*
 * In-body placement: 1-2 ads inside the main content of portal pages. Pages
 * choose the size that fits their layout:
 *   - "banner": full-width horizontal strip (dashboard, lists)
 *   - "tile":   compact card for grid pages
 *
 * Since migration 0057 what fills these comes from the Ad Manager
 * (placements "body_banner" / "body_tile") instead of a tier rule in code.
 * Sponsor-linked rows render through the original sponsor card design and
 * keep reporting impressions/clicks through the sponsor_events pipeline;
 * house notices render with the generic slot markup.
 */
export async function BodyAd({
  variant,
}: {
  variant: "banner" | "tile";
}) {
  const ads = await hydratedAdsFor(
    variant === "banner" ? "body_banner" : "body_tile",
  );
  const sponsorAds = ads.filter((a) => a.sponsor);
  const notices = ads.filter((a) => !a.sponsor);
  if (sponsorAds.length === 0 && notices.length === 0) return null;
  return (
    <>
      {sponsorAds.length > 0 && (
        <BodyAdClient
          variant={variant}
          /* Two fit the strip; the manager's order decides which two. */
          sponsors={sponsorAds.slice(0, 2).map((a) => ({
            id: a.sponsor!.id,
            name: a.title,
            tagline: a.body,
            offer: a.sponsor!.offer,
            logoUrl: a.sponsor!.logoUrl,
            sidebarAdUrl: a.imageUrl,
            wordmark: a.sponsor!.wordmark,
          }))}
        />
      )}
      <AdItems ads={notices} />
    </>
  );
}
