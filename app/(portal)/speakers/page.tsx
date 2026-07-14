import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { SpeakersIcon } from "@/components/icons";

export default function SpeakersPage() {
  return (
    <PlaceholderPage
      title="Speakers"
      subtitle="Speaker profiles, sortable by industry."
      description="Full-page speaker profiles with bios, industries, and links — sortable and filterable. Built in Phase 6."
      phase="Phase 6"
      icon={SpeakersIcon}
    />
  );
}
