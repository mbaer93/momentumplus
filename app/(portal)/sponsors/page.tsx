import Link from "next/link";
import { SponsorMark } from "@/components/sponsors/SponsorMark";
import { AdminAddChip, AdminEditChip } from "@/components/admin/AdminChips";
import { SPONSOR_INTEREST_URL } from "@/lib/links";
import { hydratedAdsFor } from "@/lib/ads";
import { requireMember } from "@/lib/current-member";
import { requireFeature } from "@/lib/entitlements";
import {
  listSponsors,
  listSponsorsNextSeason,
} from "@/lib/directory-queries";
import { upcomingSponsorReveal } from "@/lib/sponsor-lifecycle";
import { listTierCatalog } from "@/lib/tier-catalog";
import { SeasonToggle } from "@/components/directory/SeasonToggle";
import { SponsorWebsiteLink } from "@/components/sponsors/SponsorWebsiteLink";

export const dynamic = "force-dynamic";

export default async function SponsorsPage(
  props: {
    searchParams?: Promise<{ season?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const member = await requireMember();
  await requireFeature("sponsors");
  const isAdmin = member.isAdmin;
  const canPreview =
    isAdmin || member.isSpeaker || member.isSponsorManager;
  const nextView = canPreview && searchParams?.season === "next";
  // Sponsor seasons flip on April 1 (speakers keep October 1).
  const boundaryYear = upcomingSponsorReveal().getUTCFullYear();
  const sponsors = nextView
    ? await listSponsorsNextSeason()
    : await listSponsors();
  // The footer banner ("Become a partner") is an Ad Manager slot since
  // migration 0066 — copy, link, and on/off are edited there. The baked-in
  // banner only renders if the slot has no live rows (pre-migration, or
  // every row switched off).
  const footerAds = await hydratedAdsFor("sponsors_footer");

  // The Host Sponsor (the platform's own business) leads the page, then the
  // Momentum+ Sponsor hero; every other tier renders as its own labeled
  // section in catalog order (synced from TSLS Admin → Event Planning),
  // only when it has sponsors.
  const catalog = await listTierCatalog();
  const host = sponsors.filter((s) => s.tier === "host");
  const title = sponsors.filter((s) => s.tier === "momentum_plus");
  const tierSections = catalog
    .filter((t) => t.value !== "momentum_plus" && t.value !== "host")
    .map((t) => ({
      ...t,
      items: sponsors
        .filter((s) => s.tier === t.value)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((t) => t.items.length > 0);

  return (
    <div className="sponsors-pad">
      <div className="section-header">
        <div>
          <h2>Our Sponsors</h2>
          <p>The partners who make Momentum+ &amp; TSLS possible</p>
        </div>
        {isAdmin && <AdminAddChip href="/admin/sponsors" label="Add sponsor" />}
      </div>

      {canPreview && (
        <SeasonToggle
          base="/sponsors"
          next={nextView}
          nextLabel={`Apr 1, ${boundaryYear} – Apr 1, ${boundaryYear + 1}`}
        />
      )}

      {sponsors.length === 0 && (
        <div className="sessions-empty" style={{ marginTop: 20 }}>
          Sponsor partners will appear here as they come aboard.
        </div>
      )}

      {host.length > 0 && (
        <>
          <div className="sp-tier-label">Host Sponsor</div>
          {host.map((s) => (
            <div
              className="sp-title-card"
              key={s.id}
              id={s.id}
              style={{ position: "relative" }}
            >
              {isAdmin && (
                <span
                  className="admin-chip-overlay"
                  style={{ right: "auto", left: 10 }}
                >
                  <AdminEditChip href={`/admin/sponsors?edit=${s.id}`} />
                </span>
              )}
              <div className="sp-ribbon">Host Sponsor</div>
              <div className="sp-logo-lg">
                <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} maxHeight={80} />
              </div>
              <div className="sp-title-info">
                <div className="sp-title-name">{s.name}</div>
                <p className="sp-title-desc">{s.tagline}</p>
                {s.offer && (
                  <div className="sp-offer-box" style={{ maxWidth: 420 }}>
                    <strong>Member offer</strong>
                    {s.offer}
                  </div>
                )}
                <div className="sp-card-links" style={{ borderTop: "none", paddingTop: 16 }}>
                  <Link href={`/sponsors/${s.id}`} className="sp-link">
                    View profile
                  </Link>
                  <SponsorWebsiteLink sponsorId={s.id} href={s.website} />
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {title.length > 0 && (
        <>
          <div className="sp-tier-label">Momentum+ Sponsor</div>
          {title.map((s) => (
            <div
              className="sp-title-card"
              key={s.id}
              id={s.id}
              style={{ position: "relative" }}
            >
              {isAdmin && (
                <span
                  className="admin-chip-overlay"
                  style={{ right: "auto", left: 10 }}
                >
                  <AdminEditChip href={`/admin/sponsors?edit=${s.id}`} />
                </span>
              )}
              <div className="sp-ribbon">Momentum+ Sponsor</div>
              <div className="sp-logo-lg">
                <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} maxHeight={80} />
              </div>
              <div className="sp-title-info">
                <div className="sp-title-name">{s.name}</div>
                <p className="sp-title-desc">{s.tagline}</p>
                {s.offer && (
                  <div className="sp-offer-box" style={{ maxWidth: 420 }}>
                    <strong>Member offer</strong>
                    {s.offer}
                  </div>
                )}
                <div className="sp-card-links" style={{ borderTop: "none", paddingTop: 16 }}>
                  <Link href={`/sponsors/${s.id}`} className="sp-link">
                    View profile
                  </Link>
                  <SponsorWebsiteLink sponsorId={s.id} href={s.website} />
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {tierSections.map((t) => (
        <div key={t.value}>
          <div className="sp-tier-label">
            {t.value === "partner" ? "Partners" : `${t.label}s`}
          </div>
          <div className={t.items.length >= 5 || t.value === "partner" ? "sp-grid-3" : "sp-grid-2"}>
            {t.items.map((s) => (
              <div
                className="sp-card"
                key={s.id}
                id={s.id}
                style={{ position: "relative" }}
              >
                {isAdmin && (
                  <span className="admin-chip-overlay">
                    <AdminEditChip href={`/admin/sponsors?edit=${s.id}`} />
                  </span>
                )}
                <div className="sp-card-logo">
                  <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} maxHeight={56} />
                </div>
                <div className="sp-card-body">
                  <div className="sp-card-name">{s.name}</div>
                  <div className="sp-card-desc">{s.tagline}</div>
                  {s.offer && (
                    <div className="sp-offer-box">
                      <strong>Member offer</strong>
                      {s.offer}
                    </div>
                  )}
                  <div className="sp-card-links">
                    <Link href={`/sponsors/${s.id}`} className="sp-link">
                      View profile
                    </Link>
                    <SponsorWebsiteLink sponsorId={s.id} href={s.website} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {footerAds.length > 0 ? (
        footerAds.map((ad) => (
          <div className="admin-banner" style={{ marginTop: 36 }} key={ad.id}>
            <div>
              <h3>{ad.title}</h3>
              {ad.body && <p>{ad.body}</p>}
            </div>
            {ad.url && (
              <div className="admin-banner-actions">
                <a
                  className="btn-sm-gold"
                  href={ad.url}
                  {...(ad.url.startsWith("http")
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {ad.ctaLabel || "Learn more"}
                </a>
              </div>
            )}
          </div>
        ))
      ) : (
        <div className="admin-banner" style={{ marginTop: 36 }}>
          <div>
            <h3>Become a partner</h3>
            <p>
              Put your brand in front of a national community of engaged
              leaders — tasteful, integrated, and measured. This season&apos;s
              sponsorships are full; submissions are considered when 2027
              sponsorships open in April 2027.
            </p>
          </div>
          <div className="admin-banner-actions">
            <a
              className="btn-sm-gold"
              href={SPONSOR_INTEREST_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sponsorship Interest Form
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
