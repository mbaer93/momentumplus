import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { LibraryIcon } from "@/components/icons";

export default function LibraryPage() {
  return (
    <PlaceholderPage
      title="Video Library"
      subtitle="Recorded sessions with AI-generated summaries."
      description="Mux-hosted recordings with signed playback and Momentum+ AI summaries (takeaways, quotes, action items). Ships in Phase 5."
      phase="Phase 5"
      icon={LibraryIcon}
    />
  );
}
