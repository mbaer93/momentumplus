import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { SpeakersIcon } from "@/components/icons";

export default function SpeakerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <PlaceholderPage
      title="Speaker Profile"
      subtitle={`Speaker "${params.id}"`}
      description="A full-page speaker profile with bio, industries, sessions, and links. Built in Phase 6."
      phase="Phase 6"
      icon={SpeakersIcon}
    />
  );
}
