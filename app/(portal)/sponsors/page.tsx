import Link from "next/link";
import { SponsorMark } from "@/components/sponsors/SponsorMark";
import { AdminAddChip, AdminEditChip } from "@/components/admin/AdminChips";
import { SPONSOR_INTEREST_URL } from "@/lib/links";
import { requireMember } from "@/lib/current-member";
import { listSponsors } from "@/lib/directory-queries";
import {
  SPONSOR_TIERS,
  sponsorTierRank,
} from "@/lib/sponsor-tiers";
import { SponsorWebsiteLink } from "@/components/sponsors/SponsorWebsiteLink";

export const dynamic = "force-dynamic";

export default async function SponsorsPage() {
  const member = await requireMember();
  const sponsors = await listSponsors();
  const isAdmin = member.isAdmin;

  // Momentum+ Sponsor gets the hero card; every other tier renders as its
  // own labeled section, in hierarchy order, only when it has sponsors.
  const title = sponsors.filter((s) => s.tier === "momentum_plus");
  const tierSections = SPONSOR_TIERS.filter(
    (t) => t.value !== "momentum_plus",
  )
    .map((t) => ({
      ...t,
      items: sponsors
        .filter((s) => s.tier === t.value)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((t) => t.items.length > 0)
    .sort((a, b) => sponsorTierRank(a.value) - sponsorTierRank(b.value));

  return (
    <div className="sponsors-pad">
      <div className="section-header">
        <div>
          <h2>Our Sponsors</h2>
          <p>The partners who make Momentum+ possible</p>
        </div>
        {isAdmin && <AdminAddChip href="/admin/sponsors" label="Add sponsor" />}
      </div>

      {sponsors.length === 0 && (
        <div className="sessions-empty" style={{ marginTop: 20 }}>
          Sponsor partners will appear here as they come aboard.
        </div>
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

      <div className="admin-banner" style={{ marginTop: 36 }}>
        <div>
          <h3>Become a partner</h3>
          <p>
            Put your brand in front of a national community of engaged
            leaders — tasteful, integrated, and measured.
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
    </div>
  );
}
