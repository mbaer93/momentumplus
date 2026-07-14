import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { CalendarIcon } from "@/components/icons";

export default function CalendarPage() {
  return (
    <PlaceholderPage
      title="Calendar"
      subtitle="Your enrolled sessions at a glance."
      description="A month view of enrolled and available sessions with .ics export. Built alongside the sessions feature in Phase 2."
      phase="Phase 2"
      icon={CalendarIcon}
    />
  );
}
