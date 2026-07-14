import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { EducationIcon } from "@/components/icons";

export default function EducationPage() {
  return (
    <PlaceholderPage
      title="Education"
      subtitle="Structured courses and learning tracks."
      description="Curated multi-session courses building on the video library. Scheduled after the core content features land."
      phase="Phase 5+"
      icon={EducationIcon}
    />
  );
}
