import { listSessions } from "@/lib/sessions/queries";
import { SessionsBrowser } from "@/components/sessions/SessionsBrowser";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { requireMember } from "@/lib/current-member";

export const dynamic = "force-dynamic";

export const metadata = { title: "Aspire2Achieve Growth | Momentum+" };

/*
 * Aspire2Achieve Growth (Sierra, 2026-07-23): monthly 45-minute group
 * accountability sessions hosted by Sierra. Drop-in like Rooted Focus —
 * no enrollment, not recorded, Add to Calendar carries the Zoom link.
 * Sessions live in the sessions table with program = 'aspire'.
 */
export default async function Aspire2AchievePage() {
  const member = await requireMember();
  const sessions = (await listSessions()).filter((s) => s.program === "aspire");

  return (
    <div className="sessions-pad">
      <div className="section-header">
        <div>
          <h2>Aspire2Achieve Growth</h2>
          <p>Intentional growth with SMARTER goals and group accountability</p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/sessions/new" label="New session" />
        )}
      </div>

      <BodyAd variant="banner" />

      <div
        className="admin-form"
        style={{ maxWidth: "none", marginBottom: 18, padding: "16px 18px" }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--gold)",
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          About the program
        </div>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: 0 }}>
          Through the Aspire2Achieve Growth Program, we offer a holistic
          approach to personal and professional growth, led by a Full Focus
          Certified Pro specializing in SMARTER goal-setting and intentional
          growth. Whether you&apos;re seeking personalized guidance, group
          accountability, or the convenience of our on-the-go membership
          platform packed with resources, it&apos;s time to break free from
          the cycle of unmet goals and set out on a journey to unlock your
          full potential, realizing the success you&apos;ve long been
          pursuing.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: "10px 0 0" }}>
          Each month, join a <strong>45-minute group accountability
          session</strong> — commit to your ongoing personal and professional
          growth journey and celebrate your progress within a supportive
          community. Drop in — no signup needed.
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="sessions-empty" style={{ marginTop: 8 }}>
          Aspire2Achieve sessions will appear here as they&apos;re scheduled.
        </div>
      ) : (
        <SessionsBrowser sessions={sessions} isAdmin={member.isAdmin} hideFilters />
      )}
    </div>
  );
}
