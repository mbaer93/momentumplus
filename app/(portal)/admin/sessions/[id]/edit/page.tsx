import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/sessions/queries";
import { SessionForm } from "@/components/admin/SessionForm";
import { ArrowLeftIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function EditSessionPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession(params.id);
  if (!session) notFound();

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
        initial={{
          title: session.title,
          description: session.description,
          category: session.category,
          startsAtIso: session.startsAt,
          durationMin: session.durationMin,
          capacity: session.capacity,
          minAccess: session.minAccess,
          status: session.status,
        }}
      />
    </div>
  );
}
