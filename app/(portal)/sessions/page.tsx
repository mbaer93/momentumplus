import Link from "next/link";
import { listSessions } from "@/lib/sessions/queries";
import { SessionsBrowser } from "@/components/sessions/SessionsBrowser";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { requireMember } from "@/lib/current-member";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const member = await requireMember();
  // Rooted Focus sessions live on their own tab.
  const sessions = (await listSessions()).filter(
    (s) => s.program === "standard",
  );

  return (
    <div className="sessions-pad">
      <div className="section-header">
        <div>
          <h2>Sessions</h2>
          <p>Live coaching sessions, masterminds, and workshops</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {member.isAdmin && (
            <AdminAddChip href="/admin/sessions/new" label="New session" />
          )}
          <Link href="/calendar" className="btn-primary">
            View Calendar
          </Link>
        </div>
      </div>
      <BodyAd variant="banner" />
      <SessionsBrowser sessions={sessions} isAdmin={member.isAdmin} />
    </div>
  );
}
