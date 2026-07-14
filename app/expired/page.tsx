import Link from "next/link";
import { PRICING_PLANS } from "@/lib/pricing";

export const metadata = {
  title: "Renew your membership | Momentum+",
};

/*
 * Shown when a member's access has lapsed (expired / past-due beyond grace /
 * canceled period ended). Payment happens in GHL — the portal never takes
 * payment directly — so the CTA links out to the GHL checkout/renewal page.
 * Pricing copy comes from SPEC.md §2, displayed exactly as listed.
 */
export default function ExpiredPage() {
  const renewUrl = process.env.NEXT_PUBLIC_GHL_RENEW_URL || "#";

  return (
    <div className="renew-screen">
      <div className="renew-inner">
        <div className="renew-logo">
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <div className="renew-tagline">The Tri-State Leadership Community</div>

        <h1 className="renew-headline">Your membership has lapsed</h1>
        <p className="renew-sub">
          Keep the momentum going — pick the plan that fits and you&apos;ll be
          back in the room in minutes. Your learning history, notes, and
          community profile are all saved and waiting.
        </p>

        <div className="pricing-grid">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.tier}
              className={`pricing-card${plan.bestValue ? " best" : ""}`}
            >
              {plan.bestValue && (
                <span className="pricing-best-tag">Best Value</span>
              )}
              <div className="pricing-name">{plan.name}</div>
              <div className="pricing-price">{plan.price}</div>
              <div className="pricing-permonth">{plan.perMonth}</div>
              {plan.savings && (
                <span className="pricing-savings">{plan.savings}</span>
              )}
              <p className="pricing-blurb">{plan.blurb}</p>
            </div>
          ))}
        </div>

        <div className="renew-actions">
          <a
            className="btn-gold"
            href={renewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Renew Membership
          </a>
          <Link className="btn-ghost" href="/login">
            Sign in with a different account
          </Link>
        </div>

        <p className="renew-note">
          Renewed and still seeing this page? Access syncs automatically within
          a few minutes of payment. Questions:{" "}
          <a href="mailto:matt@socialdrivemedia.com">contact support</a>.
        </p>
      </div>
    </div>
  );
}
