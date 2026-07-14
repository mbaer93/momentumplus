import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { CommunityIcon } from "@/components/icons";

export default function CommunityPage() {
  return (
    <PlaceholderPage
      title="Community"
      subtitle="Tier-gated channels, direct messages, and speaker Q&A."
      description="Stream Chat powers general, networking, speaker-qa, resources, and VIP-only channels with tier-based access. This lands in Phase 4."
      phase="Phase 4"
      icon={CommunityIcon}
    />
  );
}
