import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/sessions/queries";
import { requireMember } from "@/lib/current-member";
import { isJoinWindowOpen } from "@/lib/sessions/view";
import { dateLabel, timeLabel } from "@/lib/sessions/view";
import { LiveRoom } from "@/components/sessions/LiveRoom";

export const dynamic = "force-dynamic";

export default async function LiveSessionPage({
  params,
}: {
  params: { id: string };
}) {
  const [session, member] = await Promise.all([
    getSession(params.id),
    requireMember(),
  ]);
  if (!session) notFound();

  // Enrolled-members-only (SPEC.md §4).
  if (!session.isEnrolled) {
    return (
      <div className="dash-pad">
        <div className="placeholder" style={{ margin: "40px auto" }}>
          <h3>Enroll to join this session</h3>
          <p>
            The live room is available to enrolled members. Head back to the
            session to enroll.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link href={`/sessions/${session.slug}`} className="btn-primary">
              View session
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // The room opens 30 minutes before start.
  if (!isJoinWindowOpen(session)) {
    return (
      <div className="dash-pad">
        <div className="placeholder" style={{ margin: "40px auto" }}>
          <h3>The live room isn&apos;t open yet</h3>
          <p>
            This room opens 30 minutes before the session begins —{" "}
            {dateLabel(session.startsAt)} at {timeLabel(session.startsAt)}.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link href={`/sessions/${session.slug}`} className="btn-primary">
              Back to session
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return <LiveRoom session={session} displayName={member.name} />;
}
