import Link from "next/link";
import { JoinForm } from "@/components/home/JoinForm";
import { getStripeSettings } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join Momentum+ | The Year-Round Leadership Community",
};

/*
 * Public signup page (linked from the home page pricing cards). Pay first
 * via Stripe Checkout; the account is provisioned by the webhook and the
 * welcome email walks the new member into /welcome.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams?: { plan?: string; success?: string; canceled?: string };
}) {
  const plan = searchParams?.plan === "pro" ? "pro" : "basic";
  const settings = await getStripeSettings();
  const terms = {
    basic: { 1: settings?.displayPrices?.basic ?? null, ...(settings?.termDisplay?.basic ?? {}) },
    pro: { 1: settings?.displayPrices?.pro ?? null, ...(settings?.termDisplay?.pro ?? {}) },
  };
  const success = searchParams?.success === "1";

  return (
    <div className="land-screen join-screen">
      <header className="land-nav">
        <Link href="/" className="land-wordmark" style={{ textDecoration: "none" }}>
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </Link>
        <nav className="land-nav-links">
          <Link href="/login" className="land-login-btn">
            Member Login
          </Link>
        </nav>
      </header>

      <div className="join-card">
        {success ? (
          <>
            <h1 className="join-title">Welcome to Momentum+</h1>
            <p className="join-sub">
              Payment received — you&apos;re in. Check your inbox for your
              welcome email: the link inside signs you in and helps you set a
              password and finish your profile. (Give it a minute, and check
              spam if it&apos;s shy.)
            </p>
            <p className="join-fine">
              No email after 10 minutes? Go to{" "}
              <Link href="/login" style={{ color: "var(--navy)" }}>
                the login page
              </Link>
              , choose &ldquo;Email me a sign-in link,&rdquo; and enter the
              email you just paid with — that link gets you in even if the
              welcome email went missing.
            </p>
            <Link href="/login" className="btn-gold land-cta">
              Go to login
            </Link>
          </>
        ) : (
          <>
            <h1 className="join-title">Join Momentum+</h1>
            <p className="join-sub">
              {searchParams?.canceled === "1"
                ? "No charge was made — pick up right where you left off."
                : "Pick your level, tell us who you are, and finish on our secure Stripe checkout."}
            </p>
            <JoinForm initialPlan={plan} terms={terms} />
          </>
        )}
      </div>
    </div>
  );
}
