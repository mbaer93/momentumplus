import Link from "next/link";

export const metadata = {
  title: "Terms of Service | Momentum+",
  description:
    "Membership terms for Momentum+: subscriptions, renewals, cancellation, refunds, community standards, and content use.",
  alternates: { canonical: "/terms" },
};

/*
 * Member-facing Terms of Service, drafted to match how the platform actually
 * works (Stripe subscriptions, self-serve cancellation via the billing
 * portal, community chat, certificates of completion). Approved by Matt
 * 2026-07-17 — same flow as the privacy policy.
 */
export default function TermsPage() {
  const sectionStyle = { margin: "0 0 8px", fontSize: 20 } as const;
  const pStyle = {
    margin: "0 0 12px",
    lineHeight: 1.7,
    color: "#3d4247",
    fontSize: 15,
  } as const;

  return (
    <div style={{ background: "#F8F6F1", minHeight: "100vh", padding: "40px 20px" }}>
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 4,
          padding: "clamp(20px, 5vw, 40px)",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div
            style={{ fontFamily: "Georgia, serif", fontSize: 28, color: "#0B1622" }}
          >
            Momentum<span style={{ color: "#B8965A" }}>+</span>
          </div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#B8965A",
              marginTop: 4,
            }}
          >
            Terms of Service
          </div>
        </div>

        <div
          style={{
            fontSize: 12.5,
            color: "#8a8f94",
            margin: "12px 0 20px",
            textAlign: "center",
          }}
        >
          Effective July 17, 2026
        </div>

        <p style={pStyle}>
          Momentum+ is operated by Sierra Learnership Collaborative, LLC
          (&ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or
          purchasing a membership, you agree to these terms.
        </p>

        <h2 style={sectionStyle}>Your membership</h2>
        <p style={pStyle}>
          Momentum+ is a paid, members-only community and learning platform.
          Your membership is personal to you: one person per account, and your
          login may not be shared. Plans differ in what they include (for
          example, Pro-only sessions and courses); the current inclusions are
          shown at purchase.
        </p>

        <h2 style={sectionStyle}>Billing, renewal, and cancellation</h2>
        <ul style={{ ...pStyle, paddingLeft: 20 }}>
          <li>
            <strong>Automatic renewal:</strong> memberships are subscriptions
            that renew automatically at the interval you choose at checkout
            (for example, monthly), at the then-current price, until you
            cancel. The price and interval are always shown before you pay.
          </li>
          <li>
            <strong>Payment:</strong> payments are processed by Stripe; we
            never see or store your card number. Failed payments may result in
            a short grace period followed by suspension of access until
            payment is resolved.
          </li>
          <li>
            <strong>Cancellation:</strong> cancel anytime from Profile →
            billing settings (or by contacting us below). Cancellation stops
            future renewals; you keep access through the end of the period
            you&apos;ve already paid for.
          </li>
          <li>
            <strong>Refunds:</strong> other than where required by law,
            payments are non-refundable once a billing period has started. If
            something has gone wrong — a duplicate charge, a billing mistake,
            or a problem on our end — contact us within 14 days of the charge
            and we&apos;ll make it right.
          </li>
          <li>
            <strong>Price changes:</strong> if we change membership pricing,
            we&apos;ll notify you in advance and the new price applies from
            your next renewal.
          </li>
        </ul>

        <h2 style={sectionStyle}>Community standards</h2>
        <p style={pStyle}>
          The community works because members treat it like the room at the
          summit: professional, generous, and candid. You agree not to post
          content that is unlawful, harassing, hateful, or deceptive; not to
          spam or pitch other members unsolicited; and not to share other
          members&apos; private information. We may remove content or, for
          serious or repeated violations, suspend or end a membership (with a
          pro-rated refund of any unused full months in that case).
        </p>

        <h2 style={sectionStyle}>Content and recordings</h2>
        <ul style={{ ...pStyle, paddingLeft: 20 }}>
          <li>
            <strong>Our content:</strong> sessions, recordings, courses,
            certificates, and materials are for your personal, non-commercial
            use as a member. Don&apos;t re-distribute, re-sell, or publicly
            post them.
          </li>
          <li>
            <strong>Your content:</strong> you own what you post. You give us
            a license to display it within the platform so the community
            works. Your private notes are visible only to you.
          </li>
          <li>
            <strong>Live sessions:</strong> sessions are recorded and added to
            the member library. By participating on camera or in chat, you
            consent to being part of the recording.
          </li>
        </ul>

        <h2 style={sectionStyle}>Certificates</h2>
        <p style={pStyle}>
          Course certificates are certificates of completion showing the
          educational hours associated with a course, earned by completing the
          lessons and passing the course tests. They are not accredited
          continuing-education credits; whether a certificate is accepted for
          any requirement is determined by your employer, licensing body, or
          professional association.
        </p>

        <h2 style={sectionStyle}>Third-party services</h2>
        <p style={pStyle}>
          Parts of the platform run on third-party services (Stripe, Zoom,
          Stream, Mux, and others listed in our{" "}
          <Link href="/privacy" style={{ color: "#0B1622" }}>
            Privacy Policy
          </Link>
          ). Their availability isn&apos;t fully within our control, and brief
          interruptions don&apos;t entitle members to refunds, though we&apos;ll
          always work to restore access quickly.
        </p>

        <h2 style={sectionStyle}>Disclaimers and limitation of liability</h2>
        <p style={pStyle}>
          Momentum+ provides leadership education and community — not legal,
          financial, medical, or other professional advice. The platform is
          provided &ldquo;as is.&rdquo; To the fullest extent permitted by
          law, our total liability for any claim related to the service is
          limited to the amount you paid us in the twelve months before the
          claim arose.
        </p>

        <h2 style={sectionStyle}>Account termination</h2>
        <p style={pStyle}>
          You can ask us to delete your account at any time (see the Privacy
          Policy for what deletion covers). We may suspend or terminate
          accounts that violate these terms or misuse the platform.
        </p>

        <h2 style={sectionStyle}>Changes to these terms</h2>
        <p style={pStyle}>
          We may update these terms; for material changes we&apos;ll notify
          members and update the effective date. Continuing to use Momentum+
          after a change takes effect means you accept the updated terms.
        </p>

        <h2 style={sectionStyle}>Governing law</h2>
        <p style={pStyle}>
          These terms are governed by the laws of the Commonwealth of
          Virginia, without regard to conflict-of-law rules.
        </p>

        <h2 style={sectionStyle}>Contact</h2>
        <p style={pStyle}>
          Questions, billing issues, or cancellation help:{" "}
          <a href="mailto:hello@momentumplus.co" style={{ color: "#0B1622" }}>
            hello@momentumplus.co
          </a>
          .
          <br />
          Sierra Learnership Collaborative, LLC, 117 Creekside Lane,
          Winchester, VA 22602.
        </p>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Link href="/" style={{ color: "#0B1622", fontSize: 13 }}>
            ← Back to Momentum+
          </Link>
        </div>
      </div>
    </div>
  );
}
