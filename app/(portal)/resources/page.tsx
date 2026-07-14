import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { ResourcesIcon } from "@/components/icons";

export default function ResourcesPage() {
  return (
    <PlaceholderPage
      title="Resources"
      subtitle="Partner resources with usage tracking."
      description="Downloadable and linked partner resources, gated by tier and tracked on use. Built in Phase 6."
      phase="Phase 6"
      icon={ResourcesIcon}
    />
  );
}
