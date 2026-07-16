import Link from "next/link";
import { redirect } from "next/navigation";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { ArrowLeftIcon } from "@/components/icons";
import { listActivity } from "@/lib/activity";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Activity Log | Momentum+ Admin",
};

/*
 * Full-page activity log, split into category views (Onboarding,
 * Memberships, Sessions, Learning, Engagement). Assembled from the events
 * the system already records — nothing here is a new tracking surface.
 */
export default async function AdminActivityPage() {
  // Name + email tied to sign-ins and activity — gate on the members area.
  if (isSupabaseConfigured() && !canAccessArea(await getAdminAccess(), "members")) {
    redirect("/admin");
  }

  const events = await listActivity();

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Activity Log</h2>
          <p>Who&apos;s joining, signing in, and engaging — by category</p>
        </div>
      </div>
      <ActivityFeed events={events} />
    </div>
  );
}
