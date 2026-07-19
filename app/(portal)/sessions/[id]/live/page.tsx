import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/sessions/queries";
import { requireMember } from "@/lib/current-member";
import { endMs, isJoinWindowOpen } from "@/lib/sessions/view";
import { dateLabel, timeLabel } from "@/lib/sessions/view";
import { LiveRoom } from "@/components/sessions/LiveRoom";
import { speakerOwnsSession } from "@/lib/speaker-tools";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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

  // The room opens 30 minutes before start — and closes when the session
  // ends. The two states need different words: telling someone a finished
  // session "isn't open yet" is a dead end.
  if (!isJoinWindowOpen(session)) {
    const ended = Date.now() > endMs(session);
    return (
      <div className="dash-pad">
        <div className="placeholder" style={{ margin: "40px auto" }}>
          {ended ? (
            <>
              <h3>This session has ended</h3>
              <p>
                The recording lands in the Session Library with AI takeaways,
                usually within a couple of days. Your private notes are saved
                on the session page.
              </p>
              <p style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href={`/sessions/${session.slug}`} className="btn-primary">
                  Session notes &amp; summary
                </Link>
                <Link href="/library" className="btn-ghost" style={{ color: "var(--text)" }}>
                  Browse the library
                </Link>
              </p>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    );
  }

  // Hosts run the meeting from the full Zoom client (the embedded room is
  // the participant view). Admins and the session's own speaker get a
  // "Start as host" shortcut; the start route re-checks both server-side.
  let canHost = member.isAdmin;
  if (!canHost && member.isSpeaker && isSupabaseConfigured()) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user) canHost = (await speakerOwnsSession(user.id, session.id)).ok;
  }

  return (
    <LiveRoom
      session={session}
      displayName={member.name}
      memberEmail={member.email}
      canHost={canHost}
    />
  );
}
