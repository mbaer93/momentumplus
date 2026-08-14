import Image from "next/image";
import Link from "next/link";
import { StartHubAdmin } from "@/components/start/StartHubAdmin";
import { StoreBadges } from "@/components/start/StoreBadges";
import { getAdminAccess } from "@/lib/auth-helpers";
import { readStartHubSettings, ticketsUrl, tslsStartUrl } from "@/lib/start-hub";

export const dynamic = "force-dynamic";

// Body font on sierralearnership.com — the hub mirrors her site because it
// will also live as a page there. Self-hosted; see app/fonts.css.
const RALEWAY = 'var(--font-raleway), "Raleway", sans-serif';

export const metadata = {
  title: "Get Started | Sierra Learnership Collaborative",
  description:
    "One place to reach both experiences: Momentum+, the year-round leadership community, and the TSLS App for the Tri-State Leadership Summit.",
  alternates: { canonical: "/start" },
};

/* SLC brand (from sierralearnership.com): deep forest green #144734 on a
   clean white page, Playfair Display headings, Raleway body, green footer
   band. */
const GREEN = "#144734";

/*
 * The hub (Matt, 2026-08-06): a single link to send anyone. Two cards —
 * Momentum+ and the TSLS event app — with logos, short descriptions, and
 * centered buttons. Store badges render under a card once its listing
 * link is saved in the admin box. When the TSLS App season is closed
 * (admin toggle), its card shows the closed note and a ticket-purchase
 * button for the next summit instead.
 */
export default async function StartHubPage() {
  const [settings, access] = await Promise.all([
    readStartHubSettings(),
    getAdminAccess(),
  ]);
  // Both external: the TSLS app owns its front door and its ticket sales.
  const tslsUrl = tslsStartUrl();
  const ticketsHref = ticketsUrl(settings);

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #e3e0d8",
    borderRadius: 6,
    padding: "30px 28px 26px",
    display: "flex",
    flexDirection: "column",
    gap: 13,
    color: "#2b2f33",
    boxShadow: "0 10px 30px rgba(20, 71, 52, 0.07)",
  };
  const titleStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontFamily: "'Playfair Display', serif",
    fontSize: 25,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: GREEN,
  };
  const logoStyle: React.CSSProperties = {
    borderRadius: 8,
    border: "1px solid #e3e0d8",
  };
  const descStyle: React.CSSProperties = {
    fontSize: 14,
    lineHeight: 1.7,
    color: "#4a5157",
  };
  const listStyle: React.CSSProperties = {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13.5,
    lineHeight: 2,
    color: "#4a5157",
  };
  const actionsStyle: React.CSSProperties = {
    marginTop: "auto",
    paddingTop: 18,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 11,
  };
  const greenBtnStyle: React.CSSProperties = {
    display: "inline-block",
    background: GREEN,
    color: "#fff",
    padding: "13px 30px",
    borderRadius: 4,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.3,
    textDecoration: "none",
    textAlign: "center",
  };
  const secondaryStyle: React.CSSProperties = {
    fontSize: 13.5,
    color: GREEN,
    fontWeight: 500,
    textDecoration: "underline",
    textUnderlineOffset: 3,
  };

  return (
    <div
      style={{
        fontFamily: RALEWAY,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        color: "#2b2f33",
      }}
    >
      {/* Header — seal + wordmark, like her site */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "26px 20px 20px",
          borderBottom: "1px solid #ece9e1",
        }}
      >
        <Image
          src="/slc-seal.png"
          alt="Sierra Learnership Collaborative seal"
          width={52}
          height={52}
          style={{ borderRadius: "50%" }}
        />
        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: GREEN,
          }}
        >
          Sierra Learnership Collaborative
        </div>
      </header>

      {/* Hero */}
      <section style={{ textAlign: "center", padding: "52px 20px 36px" }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            fontWeight: 700,
            color: GREEN,
            marginBottom: 14,
          }}
        >
          One community, two experiences
        </div>
        <h1
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "clamp(34px, 5vw, 52px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            color: "#1c2b24",
            margin: "0 0 16px",
          }}
        >
          Where are you headed?
        </h1>
        <p
          style={{
            maxWidth: 560,
            margin: "0 auto",
            fontSize: 15.5,
            lineHeight: 1.75,
            color: "#4a5157",
          }}
        >
          Momentum+ is the year-round leadership community. The TSLS App is
          your companion for the annual Tri-State Leadership Summit. Pick
          your destination and sign in.
        </p>
      </section>

      {/* System cards */}
      <section
        style={{
          maxWidth: 940,
          width: "100%",
          margin: "0 auto",
          padding: "0 20px 64px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 24,
          alignItems: "stretch",
        }}
      >
        {/* Momentum+ */}
        <div style={cardStyle}>
          <div style={titleStyle}>
            <Image
              src="/icons/icon-192.png"
              alt="Momentum+ logo"
              width={46}
              height={46}
              style={logoStyle}
            />
            <span>Momentum+</span>
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
            <Link href="/login" style={greenBtnStyle}>
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
              width={46}
              height={46}
              style={logoStyle}
            />
            <span>The TSLS App</span>
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
              <>
                <a href={tslsUrl} style={greenBtnStyle}>
                  Open the TSLS App
                </a>
                <a
                  href={ticketsHref}
                  style={secondaryStyle}
                  rel="noopener noreferrer"
                >
                  Purchase tickets to the summit
                </a>
              </>
            ) : (
              <>
                <div
                  style={{
                    padding: "11px 16px",
                    borderRadius: 4,
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    border: "1px solid rgba(20, 71, 52, 0.25)",
                    background: "rgba(20, 71, 52, 0.05)",
                    color: "#2f4a3e",
                    textAlign: "center",
                  }}
                >
                  {settings.closedNote}
                </div>
                <a
                  href={ticketsHref}
                  style={greenBtnStyle}
                  rel="noopener noreferrer"
                >
                  Get your ticket for next year
                </a>
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

      {/* Footer — the green band from her site */}
      <footer
        style={{
          marginTop: "auto",
          background: GREEN,
          color: "rgba(255, 255, 255, 0.85)",
          textAlign: "center",
          padding: "26px 20px",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        Sierra Learnership Collaborative, LLC — Momentum+ and the Tri-State
        Leadership Summit
      </footer>
    </div>
  );
}
