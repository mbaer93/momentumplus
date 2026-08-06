import { listSessions } from "@/lib/sessions/queries";
import { AspireCopy } from "@/components/sessions/AspireCopy";
import { SessionsBrowser } from "@/components/sessions/SessionsBrowser";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { readAspireCopy } from "@/lib/aspire-copy";
import { requireMember } from "@/lib/current-member";
import { requireFeature } from "@/lib/entitlements";

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
  await requireFeature("aspire2achieve");
  const [allSessions, copy] = await Promise.all([
    listSessions(),
    readAspireCopy(),
  ]);
  const sessions = allSessions.filter((s) => s.program === "aspire");

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

      <AspireCopy text={copy} isAdmin={member.isAdmin} />

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
