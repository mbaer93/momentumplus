import Link from "next/link";
import { getPendingSpeakerInvite } from "./actions";
import { SpeakerOnboardingForm } from "./SpeakerOnboardingForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Speaker setup | Momentum+",
};

/*
 * Landing page for invited speakers (their invite email signs them in and
 * sends them here). One form: their public speaker page, their business
 * (published as a member resource), their own details, and a password when
 * the invite created the account. Submitting grants speaker-tier access
 * through October 1 of next year and unlocks the Speaker Studio.
 */
export default async function SpeakerOnboardingPage() {
  const invite = await getPendingSpeakerInvite();

  return (
    <div className="login-inner" style={{ width: 560, maxWidth: "100%" }}>
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Speaker Setup</div>
      {invite.pending ? (
        <SpeakerOnboardingForm
          initialName={invite.displayName ?? ""}
          needsPassword={Boolean(invite.needsPassword)}
        />
      ) : (
        <div className="login-card">
          <h2>No pending speaker setup</h2>
          <p>
            This account doesn&apos;t have a speaker invitation waiting. If
            you were expecting one, ask the Momentum+ team to re-send it.
          </p>
          <Link
            href="/dashboard"
            className="login-btn"
            style={{ display: "block", textAlign: "center", textDecoration: "none" }}
          >
            Go to the portal
          </Link>
        </div>
      )}
    </div>
  );
}
