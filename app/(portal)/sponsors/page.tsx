import { SponsorMark } from "@/components/sponsors/SponsorMark";
import { AdminAddChip, AdminEditChip } from "@/components/admin/AdminChips";
import { SPONSOR_INTEREST_URL } from "@/lib/links";
import { requireMember } from "@/lib/current-member";
import { listSponsors } from "@/lib/directory-queries";
import { ExternalIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function SponsorsPage() {
  const member = await requireMember();
  const sponsors = await listSponsors();
  const isAdmin = member.isAdmin;

  const title = sponsors.filter((s) => s.tier === "title");
  const partners = sponsors.filter((s) => s.tier === "partner");
  const community = sponsors.filter((s) => s.tier === "community");

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
          <div className="sp-tier-label">Title Sponsor</div>
          {title.map((s) => (
            <div
              className="sp-title-card"
              key={s.id}
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
              <div className="sp-ribbon">Title Sponsor</div>
              <div className="sp-logo-lg">
                <SponsorMark name={s.name} logoUrl={s.logoUrl} wordmark={s.wordmark} maxHeight={80} />
              </div>
              <div className="sp-title-info">
                <div className="sp-title-name">{s.name}</div>
                <p className="sp-title-desc">{s.tagline}</p>
                <div className="sp-card-links" style={{ borderTop: "none", paddingTop: 16 }}>
                  <a
                    className="sp-link"
                    href={s.website}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                  >
                    Visit website <ExternalIcon size={12} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {partners.length > 0 && (
        <>
          <div className="sp-tier-label">Partner Sponsors</div>
          <div className="sp-grid-2">
            {partners.map((s) => (
              <div
                className="sp-card"
                key={s.id}
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
                    <a
                      className="sp-link"
                      href={s.website}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                    >
                      Visit website <ExternalIcon size={12} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {community.length > 0 && (
        <>
          <div className="sp-tier-label">Community Sponsors</div>
          <div className="sp-grid-3">
            {community.map((s) => (
              <div
                className="sp-card"
                key={s.id}
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
                    <a
                      className="sp-link"
                      href={s.website}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                    >
                      Visit website <ExternalIcon size={12} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="admin-banner" style={{ marginTop: 36 }}>
        <div>
          <h3>Become a partner</h3>
          <p>
            Put your brand in front of the Tri-State&apos;s most engaged
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
