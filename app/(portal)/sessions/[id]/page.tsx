import { notFound } from "next/navigation";
import { getSession } from "@/lib/sessions/queries";
import { SessionDetailView } from "@/components/sessions/SessionDetailView";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession(params.id);
  if (!session) notFound();

  return <SessionDetailView session={session} />;
}
