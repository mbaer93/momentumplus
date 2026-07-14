import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { SessionsIcon } from "@/components/icons";

export default function SessionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <PlaceholderPage
      title="Session Detail"
      subtitle={`Session "${params.id}"`}
      description="The session detail view — enroll, add to calendar, view the speaker, take private notes, and (after the session) watch the recording and AI summary. Built in Phase 2 and Phase 5."
      phase="Phase 2"
      icon={SessionsIcon}
    />
  );
}
