import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { AdminIcon } from "@/components/icons";

// The full admin portal (dashboard, content, announcements, users, sponsors)
// with its purple chrome is built in Phase 7 (SPEC.md §5). Admin-tier only.
export default function AdminPage() {
  return (
    <PlaceholderPage
      title="Admin Panel"
      subtitle="Manage members, sessions, content, sponsors, and announcements."
      description="The full admin portal — content CRUD, member management, the announcement composer, and sponsor management — with purple admin chrome. Built in Phase 7."
      phase="Phase 7"
      icon={AdminIcon}
    />
  );
}
