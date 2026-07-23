import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Momentum+",
  description:
    "How Momentum+ collects, uses, and shares members' personal information.",
};

/*
 * Member-facing privacy policy. The data-collection and data-sharing
 * sections are grounded in what the platform actually does (see the security
 * audit's data-sharing inventory). Company details filled in and approved;
 * update the effective date if the policy materially changes.
 */
export default function PrivacyPage() {
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
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 28,
              color: "#0B1622",
            }}
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
            Privacy Policy
          </div>
        </div>

        <p style={{ ...pStyle, marginTop: 22 }}>
          <strong>Effective date:</strong> July 16, 2026
        </p>
        <p style={pStyle}>
          Momentum+ is operated by Sierra Learnership Collaborative, LLC (“we,”
          “us”) as the members-only community and learning platform for the
          Tri-State Leadership Summit. This policy explains what personal
          information we collect, how we use it, and who we share it with.
        </p>

        <h2 style={sectionStyle}>Information we collect</h2>
        <ul style={{ ...pStyle, paddingLeft: 20 }}>
          <li>
            <strong>Account &amp; profile:</strong> your name, email address,
            phone number, company, job title, industry, and any bio you add.
          </li>
          <li>
            <strong>Membership &amp; payment status:</strong> your plan, access
            dates, and payment status. Card details are entered directly with
            our payment processor — <strong>we never see or store card numbers.</strong>
          </li>
          <li>
            <strong>Activity:</strong> sessions you enroll in and attend,
            recordings you watch, courses and lessons you complete, resources you
            open, and private notes you save.
          </li>
          <li>
            <strong>Community content:</strong> messages and direct messages you
            send in the member community.
          </li>
          <li>
            <strong>Technical:</strong> sign-in times and standard log data used
            to keep the service secure.
          </li>
        </ul>

        <h2 style={sectionStyle}>How we use it</h2>
        <p style={pStyle}>
          To provide the portal and your membership; to run live sessions and
          track attendance; to power the community, the video library, courses,
          and certificates; to send you service and reminder messages; to process
          your membership and payments; and to keep the platform secure. We do
          not sell your personal information.
        </p>

        <h2 style={sectionStyle}>Service providers we share data with</h2>
        <p style={pStyle}>
          We share the minimum necessary with the providers that make the
          platform work. Each processes your data only to provide their service:
        </p>
        <div style={{ overflowX: "auto", margin: "0 0 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #0B1622" }}>
                <th style={{ padding: "6px 8px" }}>Provider</th>
                <th style={{ padding: "6px 8px" }}>What they receive</th>
                <th style={{ padding: "6px 8px" }}>Purpose</th>
              </tr>
            </thead>
            <tbody style={{ color: "#3d4247" }}>
              {[
                ["Stripe", "Name, email, payment details (entered on Stripe), plan", "Subscription billing"],
                ["Go High Level", "Name, email, phone (for opted-in SMS), message content", "Billing sync, email/SMS notifications"],
                ["GetStream (Stream Chat)", "Display name, chat and direct-message content", "Member community chat"],
                ["Zoom", "Name and email when you join a live session; participation", "Live sessions & attendance"],
                ["Mux", "Session/course recordings and transcripts", "Video hosting & captions"],
                ["Anthropic", "Session transcripts and help-chat messages (no name/email added by us)", "AI summaries & help assistant"],
                ["Resend (via Supabase)", "Email address, name, sign-in links", "Account & authentication email"],
                ["Google", "Event-registration name, email, type", "Registration import"],
                ["Zapier", "Name, email, plan", "Member-provisioning automation"],
                ["Vercel & Supabase", "All of the above, as hosting & database", "Infrastructure"],
              ].map((row) => (
                <tr key={row[0]} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{row[0]}</td>
                  <td style={{ padding: "6px 8px" }}>{row[1]}</td>
                  <td style={{ padding: "6px 8px" }}>{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={pStyle}>
          We may also disclose information if required by law, or as part of a
          business transfer. We do not otherwise share your personal information
          with third parties for their own marketing.
        </p>

        <h2 style={sectionStyle}>Your choices and rights</h2>
        <ul style={{ ...pStyle, paddingLeft: 20 }}>
          <li>
            <strong>Access &amp; correction:</strong> view and edit your profile
            any time under Profile → Settings.
          </li>
          <li>
            <strong>Notifications:</strong> manage email and SMS preferences in
            your profile; some essential account emails can’t be turned off.
          </li>
          <li>
            <strong>Deletion:</strong> ask us to delete your account and personal
            information by contacting us below. When we delete a member, we remove
            their account and data from our systems and cancel active billing;
            some records may be retained where required by law.
          </li>
        </ul>

        <h2 style={sectionStyle}>Security</h2>
        <p style={pStyle}>
          Access to member data is controlled at the database level, private
          notes are visible only to you, secrets are never exposed to the
          browser, and passwords are checked against known-breach lists. No
          system is perfectly secure, but we work to protect your information.
        </p>

        <h2 style={sectionStyle}>Retention</h2>
        <p style={pStyle}>
          We keep your information for as long as your membership is active and
          as needed to provide the service, resolve disputes, and meet legal
          obligations, after which it is deleted or de-identified.
        </p>

        <h2 style={sectionStyle}>Children</h2>
        <p style={pStyle}>
          Momentum+ is intended for business professionals and is not directed to
          anyone under 18. We do not knowingly collect information from children.
        </p>

        <h2 style={sectionStyle}>Changes</h2>
        <p style={pStyle}>
          We may update this policy; we’ll revise the effective date above and,
          for material changes, notify members.
        </p>

        <h2 style={sectionStyle}>Contact</h2>
        <p style={pStyle}>
          Questions or requests:{" "}
          <a href="mailto:hello@momentumplus.co" style={{ color: "#0B1622" }}>
            hello@momentumplus.co
          </a>
          .
          <br />
          Sierra Learnership Collaborative, LLC, 117 Creekside Lane, Winchester,
          VA 22602.
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
