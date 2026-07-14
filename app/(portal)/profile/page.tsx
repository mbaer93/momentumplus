import { PlaceholderPage } from "@/components/portal/PlaceholderPage";
import { ProfileIcon } from "@/components/icons";

export default function ProfilePage() {
  return (
    <PlaceholderPage
      title="My Profile"
      subtitle="Your learning history and notification preferences."
      description="Edit your profile, review your learning record (enrollments, attendance, notes), and manage email/SMS/in-app notification preferences. Preferences UI ships in Phase 4."
      phase="Phase 4"
      icon={ProfileIcon}
    />
  );
}
