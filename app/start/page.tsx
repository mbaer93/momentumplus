import Image from "next/image";
import Link from "next/link";
import { StartHubAdmin } from "@/components/start/StartHubAdmin";
import { StoreBadges } from "@/components/start/StoreBadges";
import { getAdminAccess } from "@/lib/auth-helpers";
import { readStartHubSettings, tslsAppUrl } from "@/lib/start-hub";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Get Started | Sierra Learnership Collaborative",
  description:
    "One place to reach both experiences: Momentum+, the year-round leadership community, and the TSLS App for the Tri-State Leadership Summit.",
  alternates: { canonical: "/start" },
};

/*
 * The hub (Matt, 2026-08-06): a single link to send anyone. Two cards —
 * Momentum+ and the TSLS event app — each with its logo, a description,
 * and centered buttons at the bottom. Store badges render under a card
 * once its listing link is saved in the admin box. When the TSLS App
 * season is closed (admin toggle), its card shows the closed note and a
 * ticket-purchase button for the next summit instead.
 *
 * The landing shell is dark navy, so the white cards set their own dark
 * text colors — the land-* tokens are tuned for the dark background.
 */
export default async function StartHubPage() {
  const [settings, access] = await Promise.all([
    readStartHubSettings(),
    getAdminAccess(),
  ]);
  const tslsUrl = tslsAppUrl();

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid var(--warm-gray)",
    borderRadius: 4,
    padding: "28px 26px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    color: "#1c2733",
  };
  const titleStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontFamily: "'Playfair Display', serif",
    fontSize: 24,
    fontWeight: 700,
    color: "#0b1622",
  };
  const logoStyle: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid var(--warm-gray)",
  };
  const descStyle: React.CSSProperties = {
    fontSize: 13.5,
    lineHeight: 1.65,
    color: "#3d4653",
  };
  const listStyle: React.CSSProperties = {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13.5,
    lineHeight: 1.9,
    color: "#3d4653",
  };
  const actionsStyle: React.CSSProperties = {
    marginTop: "auto",
    paddingTop: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
  };
  const secondaryStyle: React.CSSProperties = {
    fontSize: 13,
    color: "#5b6673",
    textDecoration: "underline",
    textUnderlineOffset: 3,
  };

  return (
    <div className="land-screen">
      <header className="land-nav">
        <div className="land-wordmark">
          Sierra Learnership <span style={{ color: "var(--gold)" }}>Collaborative</span>
        </div>
      </header>

      <section className="land-hero" style={{ paddingBottom: 28 }}>
        <div className="land-badge">One community, two experiences</div>
        <h1>Where are you headed?</h1>
        <p>
          Momentum+ is the year-round leadership community. The TSLS App is
          your companion for the annual Tri-State Leadership Summit. Pick
          your destination and sign in.
        </p>
      </section>

      <section
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "0 20px 56px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 22,
          alignItems: "stretch",
        }}
      >
        {/* Momentum+ */}
        <div style={cardStyle}>
          <div style={titleStyle}>
            <Image
              src="/icons/icon-192.png"
              alt="Momentum+ logo"
              width={44}
              height={44}
              style={logoStyle}
            />
            <span>
              Momentum<span style={{ color: "var(--gold)" }}>+</span>
            </span>
          </div>
          <div style={descStyle}>
            The year-round leadership community and learning platform — so
            growth doesn&apos;t stop when the summit ends.
          </div>
          <ul style={listStyle}>
            <li>Live monthly sessions with nationally recognized speakers</li>
            <li>Full session library with AI takeaways and action items</li>
            <li>Self-paced courses with certificates of completion</li>
            <li>Private community, member directory, and speaker Q&amp;A</li>
            <li>The Branching Out podcast, seasons and all</li>
          </ul>
          <div style={actionsStyle}>
            <Link href="/login" className="btn-gold land-cta">
              Log in to Momentum+
            </Link>
            <Link href="/" style={secondaryStyle}>
              Learn about membership
            </Link>
            <StoreBadges
              appStoreUrl={settings.momentumAppStoreUrl}
              playUrl={settings.momentumPlayUrl}
            />
          </div>
        </div>

        {/* TSLS App */}
        <div style={cardStyle}>
          <div style={titleStyle}>
            <Image
              src="/tsls-app-icon.png"
              alt="TSLS App logo"
              width={44}
              height={44}
              style={logoStyle}
            />
            <span>
              The TSLS <span style={{ color: "var(--gold)" }}>App</span>
            </span>
          </div>
          <div style={descStyle}>
            Your companion for the annual Tri-State Leadership Summit — open
            in the weeks around the event.
          </div>
          <ul style={listStyle}>
            <li>Your ticket and check-in QR code</li>
            <li>The live agenda and day-of schedule</li>
            <li>Know Before You Go: parking, lunch, and logistics</li>
            <li>The full speaker lineup</li>
            <li>Announcements and updates during the summit</li>
          </ul>
          <div style={actionsStyle}>
            {settings.tslsOpen ? (
              <a href={tslsUrl} className="btn-gold land-cta">
                Open the TSLS App
              </a>
            ) : (
              <>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 4,
                    fontSize: 13,
                    lineHeight: 1.6,
                    border: "1px solid var(--warm-gray)",
                    background: "var(--cream)",
                    color: "#3d4653",
                    textAlign: "center",
                  }}
                >
                  {settings.closedNote}
                </div>
                <Link href="/tickets" className="btn-gold land-cta">
                  Get your ticket for next year
                </Link>
              </>
            )}
            <StoreBadges
              appStoreUrl={settings.tslsAppStoreUrl}
              playUrl={settings.tslsPlayUrl}
            />
          </div>
        </div>
      </section>

      {access && <StartHubAdmin settings={settings} />}

      <footer className="land-footer">
        <div className="land-footer-note">
          Sierra Learnership Collaborative, LLC — Momentum+ and the
          Tri-State Leadership Summit
        </div>
      </footer>
    </div>
  );
}
