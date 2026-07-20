import { StarIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";

export const dynamic = "force-dynamic";

export const metadata = { title: "Aspire2Achieve Growth | Momentum+" };

/*
 * Placeholder: the Aspire2Achieve Growth program details are coming from
 * Matt — keep this page a tasteful teaser until then.
 */
export default async function Aspire2AchievePage() {
  await requireMember();

  return (
    <div className="resources-pad">
      <div className="section-header">
        <div>
          <h2>Aspire2Achieve Growth</h2>
          <p>A new Momentum+ program</p>
        </div>
      </div>
      <div
        className="sessions-empty"
        style={{
          marginTop: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "48px 24px",
        }}
      >
        <span style={{ color: "var(--gold)" }}>
          <StarIcon size={28} />
        </span>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Coming soon</div>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          We&apos;re putting the finishing touches on Aspire2Achieve Full
          Focus. Details will land here first — watch this space.
        </div>
      </div>
    </div>
  );
}
