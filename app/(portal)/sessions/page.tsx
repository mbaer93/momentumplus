import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { SessionsIcon } from "@/components/icons";

export default function SessionsPage() {
  return (
    <PlaceholderPage
      title="Sessions"
      subtitle="Live and scheduled sessions with enrollment, attendance, and calendar sync."
      description="Browse and enroll in sessions, download .ics calendar files, and join live via Zoom. Full CRUD and Zoom integration arrive in Phase 2."
      phase="Phase 2"
      icon={SessionsIcon}
    />
  );
}
