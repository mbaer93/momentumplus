import { Wordmark } from "@/components/sponsors/Wordmark";
import { requireMember } from "@/lib/current-member";
import { listSponsors } from "@/lib/directory-queries";
import { ExternalIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function SponsorsPage() {
  await requireMember();
  const sponsors = await listSponsors();

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
            <div className="sp-title-card" key={s.id}>
              <div className="sp-ribbon">Title Sponsor</div>
              <div className="sp-logo-lg">
                <Wordmark kind={s.wordmark} />
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
              <div className="sp-card" key={s.id}>
                <div className="sp-card-logo">
                  <Wordmark kind={s.wordmark} />
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
              <div className="sp-card" key={s.id}>
                <div className="sp-card-logo">
                  <Wordmark kind={s.wordmark} />
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
    </div>
  );
}
