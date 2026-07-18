import { RenewButtons } from "@/components/billing/RenewButtons";
import { getStripeSettings, stripeReady } from "@/lib/stripe";

export const metadata = {
  title: "Renew your membership | Momentum+",
};

/*
 * Shown when a member's access has lapsed (expired / past-due beyond grace /
 * canceled period ended). Once Stripe is connected (Admin → Billing wizard),
 * renewal happens right here via Checkout; otherwise the CTA links out to
 * the GHL renewal page. Shows the CURRENT two member levels (Member/Pro) —
 * the legacy monthly/3/6/12 plans are gone.
 */
export default async function ExpiredPage() {
  // No Stripe and no GHL renewal page configured → the only honest CTA is
  // "email us", not a button that opens a blank tab.
  const renewUrl = process.env.NEXT_PUBLIC_GHL_RENEW_URL || null;
  const stripe = await getStripeSettings();
  const stripeLive = stripeReady(stripe);

  return (
    <div className="renew-screen">
      <div className="renew-inner">
        <div className="renew-logo">
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <div className="renew-tagline">The Year-Round Leadership Community</div>

        <h1 className="renew-headline">Your membership has lapsed</h1>
        <p className="renew-sub">
          Keep the momentum going — pick the plan that fits and you&apos;ll be
          back in the room in minutes. Your learning history, notes, and
          community profile are all saved and waiting.
        </p>

        <div className="pricing-grid" style={{ maxWidth: 560, margin: "0 auto" }}>
          <div className="pricing-card">
            <div className="pricing-name">Momentum+ Member</div>
            <div className="pricing-price">
              {stripe?.displayPrices?.basic
                ? `$${stripe.displayPrices.basic}/mo`
                : "Membership"}
            </div>
            <p className="pricing-blurb">
              Live sessions, the full library, core courses, and the community.
            </p>
          </div>
          <div className="pricing-card best">
            <span className="pricing-best-tag">Most Access</span>
            <div className="pricing-name">Momentum+ Pro</div>
            <div className="pricing-price">
              {stripe?.displayPrices?.pro
                ? `$${stripe.displayPrices.pro}/mo`
                : "Membership"}
            </div>
            <p className="pricing-blurb">
              Everything in Member, plus Pro-only sessions, recordings,
              advanced tracks, and premium resources.
            </p>
          </div>
        </div>

        <div className="renew-actions">
          {stripeLive ? (
            <RenewButtons
              basicPrice={stripe.displayPrices?.basic ?? null}
              proPrice={stripe.displayPrices?.pro ?? null}
            />
          ) : renewUrl ? (
            <a
              className="btn-gold"
              href={renewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Renew Membership
            </a>
          ) : (
            <a className="btn-gold" href="mailto:hello@momentumplus.co?subject=Renew%20my%20Momentum%2B%20membership">
              Email us to renew
            </a>
          )}
          {/* Must sign out first — a plain /login link bounces a lapsed
              (but authenticated) member straight back here. */}
          <form action="/auth/signout" method="post" style={{ display: "inline" }}>
            <button type="submit" className="btn-ghost">
              Sign in with a different account
            </button>
          </form>
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
