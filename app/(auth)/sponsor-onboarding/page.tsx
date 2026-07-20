import Link from "next/link";
import { getPendingSponsorInvite } from "./actions";
import { SponsorOnboardingForm } from "./SponsorOnboardingForm";
import { RAIL_TIERS, normalizeSponsorTier, sponsorTierLabel } from "@/lib/sponsor-tiers";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sponsor setup | Momentum+",
};

/*
 * Landing page for invited sponsor reps (the invite email signs them in and
 * sends them here). One form: the business's public listing + the rep's own
 * details (+ a password when the invite created their account). Submitting
 * creates the sponsor entry, seats the rep, and grants Pro access through
 * October 1.
 */
export default async function SponsorOnboardingPage() {
  const invite = await getPendingSponsorInvite();

  return (
    <div className="login-inner" style={{ width: 520, maxWidth: "100%" }}>
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Sponsor Setup</div>
      {invite.pending ? (
        <SponsorOnboardingForm
          tierLabel={sponsorTierLabel(invite.tier ?? "partner")}
          initialBusinessName={invite.businessName ?? ""}
          needsPassword={Boolean(invite.needsPassword)}
          ticketAllotment={invite.ticketAllotment ?? 0}
          adEligible={RAIL_TIERS.has(normalizeSponsorTier(invite.tier ?? "partner"))}
        />
      ) : (
        <div className="login-card">
          <h2>No pending sponsor setup</h2>
          <p>
            This account doesn&apos;t have a sponsor invitation waiting. If
            you were expecting one, ask the Momentum+ team to re-send it — or
            head into the portal.
          </p>
          <Link href="/dashboard" className="login-btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
            Go to the portal
          </Link>
        </div>
      )}
    </div>
  );
}
