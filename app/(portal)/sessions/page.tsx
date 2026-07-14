import Link from "next/link";
import { listSessions } from "@/lib/sessions/queries";
import { SessionsBrowser } from "@/components/sessions/SessionsBrowser";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await listSessions();

  return (
    <div className="sessions-pad">
      <div className="section-header">
        <div>
          <h2>Sessions</h2>
          <p>Live coaching sessions, masterminds, and workshops</p>
        </div>
        <Link href="/calendar" className="btn-primary">
          View Calendar
        </Link>
      </div>
      <SessionsBrowser sessions={sessions} />
    </div>
  );
}
