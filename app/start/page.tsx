import Link from "next/link";
import { StartHubAdmin } from "@/components/start/StartHubAdmin";
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
 * Momentum+ and the TSLS event app — each with a short description and a
 * login/open button. When the TSLS App season is closed (admin toggle on
 * this page), its card shows the closed note and a ticket-purchase button
 * for the next summit instead.
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
    padding: "28px 26px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };
  const listStyle: React.CSSProperties = {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13.5,
    lineHeight: 1.9,
    color: "var(--mid-gray)",
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
        }}
      >
        {/* Momentum+ */}
        <div style={cardStyle}>
          <div
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Momentum<span style={{ color: "var(--gold)" }}>+</span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
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
          <div style={{ marginTop: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/login" className="btn-gold land-cta">
              Log in to Momentum+
            </Link>
            <Link href="/" className="land-ghost-btn">
              Learn about membership
            </Link>
          </div>
        </div>

        {/* TSLS App */}
        <div style={cardStyle}>
          <div
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            The TSLS <span style={{ color: "var(--gold)" }}>App</span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
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
          {settings.tslsOpen ? (
            <div style={{ marginTop: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a href={tslsUrl} className="btn-gold land-cta">
                Open the TSLS App
              </a>
            </div>
          ) : (
            <div style={{ marginTop: "auto" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 4,
                  fontSize: 13,
                  lineHeight: 1.6,
                  border: "1px solid var(--warm-gray)",
                  background: "var(--cream)",
                  color: "var(--mid-gray)",
                  marginBottom: 12,
                }}
              >
                {settings.closedNote}
              </div>
              <Link href="/tickets" className="btn-gold land-cta">
                Get your ticket for next year
              </Link>
            </div>
          )}
        </div>
      </section>

      {access && (
        <StartHubAdmin
          tslsOpen={settings.tslsOpen}
          closedNote={settings.closedNote}
        />
      )}

      <footer className="land-footer">
        <div className="land-footer-note">
          Sierra Learnership Collaborative, LLC — Momentum+ and the
          Tri-State Leadership Summit
        </div>
      </footer>
    </div>
  );
}
