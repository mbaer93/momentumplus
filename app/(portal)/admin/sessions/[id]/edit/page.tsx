import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/sessions/queries";
import { SessionForm } from "@/components/admin/SessionForm";
import { ArrowLeftIcon } from "@/components/icons";
import { listSpeakersForAdmin } from "@/lib/directory-queries";
import { isoToEasternInput } from "@/lib/eastern-time";

export const dynamic = "force-dynamic";

export default async function EditSessionPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession(params.id);
  if (!session) notFound();
  const speakers = (await listSpeakersForAdmin()).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return (
    <div className="admin-pad">
      <Link href="/admin/sessions" className="sess-back">
        <ArrowLeftIcon size={12} /> Back to sessions
      </Link>
      <div className="section-header">
        <div>
          <h2>Edit Session</h2>
          <p>{session.title}</p>
        </div>
      </div>
      <SessionForm
        mode="edit"
        sessionId={session.id}
        speakers={speakers}
        initial={{
          title: session.title,
          description: session.description,
          category: session.category,
          startsAtIso: session.startsAt,
          durationMin: session.durationMin,
          capacity: session.capacity,
          minAccess: session.minAccess,
          status: session.status,
          speakerId: speakers.some((s) => s.id === session.speaker.id)
            ? session.speaker.id
            : "",
          program: session.program,
          recurrence: session.recurrence ?? "",
          recurrenceUntil: session.recurrenceUntil
            ? isoToEasternInput(session.recurrenceUntil).slice(0, 10)
            : "",
          hostName: session.hostName ?? "",
        }}
      />
    </div>
  );
}
