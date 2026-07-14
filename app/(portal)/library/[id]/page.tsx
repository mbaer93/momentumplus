import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { LibraryIcon } from "@/components/icons";

export default function VideoDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <PlaceholderPage
      title="Recording"
      subtitle={`Video "${params.id}"`}
      description="Signed Mux playback with the AI summary panel and private notes. Built in Phase 5."
      phase="Phase 5"
      icon={LibraryIcon}
    />
  );
}
