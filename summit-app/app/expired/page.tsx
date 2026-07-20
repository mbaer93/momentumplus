import { momentumUrl } from "@/lib/momentum";
import { getSummitSettings } from "@/lib/summit-queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Access expired | TSLS Summit Companion" };

// Lapsed members land here (the summit shell requires an active membership,
// same grace semantics as Momentum+). Renewal and billing live on the
// Momentum+ side; summit registration re-grants access automatically.
export default async function ExpiredPage() {
  const settings = await getSummitSettings();
  return (
    <div className="login-screen">
      <div className="login-inner">
        <div className="login-logo">TSLS</div>
        <div className="login-tagline">Tri-State Leadership Summit Companion</div>
        <div className="login-card">
          <h2>Your access has ended</h2>
          <p>
            Your membership or summit access window has expired. Registering
            for the summit restores access automatically, or you can renew
            your membership on Momentum+.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            <a className="login-btn" href={settings.registrationUrl}>
              Register for the summit
            </a>
            <a
              className="login-btn"
              style={{ background: "transparent", border: "1px solid var(--gold)", color: "var(--gold)" }}
              href={momentumUrl("/upgrade")}
            >
              Renew on Momentum+
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
