import { redirect } from "next/navigation";
import { RenewButtons } from "@/components/billing/RenewButtons";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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
  // Sponsor reps and speakers whose comped season ended get an explanation,
  // not just the generic "pick a plan" paywall.
  let endedNote: string | null = null;

  // Self-heal wrong-door arrivals: a signed-in user with an OPEN speaker or
  // sponsor invite has no membership YET because their onboarding hasn't
  // run — send them to it instead of asking them to pay. (Invite emails can
  // land on the generic welcome flow when the email template drops the
  // per-invite redirect.)
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user) {
      // Same profile-id-OR-email rule as the onboarding pages themselves —
      // diverging keys once trapped people in a redirect loop.
      const admin = createServiceClient();
      const { findOpenInvite } = await import("@/lib/invite-lookup");
      const [speakerInvite, sponsorInvite] = await Promise.all([
        findOpenInvite(admin, "speaker_invites", user),
        findOpenInvite(admin, "sponsor_invites", user),
      ]);
      if (speakerInvite) redirect("/speaker-onboarding");
      if (sponsorInvite) redirect("/sponsor-onboarding");

      const { sponsorActive } = await import("@/lib/sponsor-lifecycle");
      const [{ data: speakerRow }, { data: seatRows }] = await Promise.all([
        admin
          .from("speakers")
          .select("expires_at, archived_at")
          .eq("profile_id", user.id)
          .maybeSingle(),
        admin
          .from("sponsor_members")
          .select("sponsors ( name, expires_at, archived_at )")
          .eq("profile_id", user.id),
      ]);
      if (
        speakerRow &&
        !sponsorActive({
          archivedAt: (speakerRow.archived_at as string | null) ?? null,
          expiresAt: (speakerRow.expires_at as string | null) ?? null,
        })
      ) {
        endedNote =
          "Your speaker season has ended, which is why your access stopped — that's the normal October 1 rollover, not a billing problem. If you're speaking again next season, the Momentum+ team can reinstate you. You're also welcome to stay in the community year-round with a plan below.";
      } else {
        const endedSponsor = (seatRows ?? [])
          .map(
            (r) =>
              (r as unknown as {
                sponsors: {
                  name: string;
                  expires_at: string | null;
                  archived_at: string | null;
                } | null;
              }).sponsors,
          )
          .find(
            (s) =>
              s &&
              !sponsorActive({
                archivedAt: s.archived_at,
                expiresAt: s.expires_at,
              }),
          );
        if (endedSponsor) {
          endedNote = `Your access came with ${endedSponsor.name}'s sponsorship, which has ended. To renew the sponsorship, email the Momentum+ team at hello@momentumplus.co — or continue personally with a plan below.`;
        }
      }
    }
  }

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

        <h1 className="renew-headline">
          {endedNote ? "Your season has ended" : "Your membership has lapsed"}
        </h1>
        {endedNote && (
          <p
            className="renew-sub"
            style={{
              border: "1px solid var(--gold, #B8965A)",
              borderRadius: 4,
              padding: "12px 16px",
            }}
          >
            {endedNote}
          </p>
        )}
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
          <a href="mailto:hello@momentumplus.co">contact support</a>.
        </p>
      </div>
    </div>
  );
}
