import { ResourcesBrowser } from "@/components/resources/ResourcesBrowser";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { requireMember } from "@/lib/current-member";
import { listResources, resourceUnlocked } from "@/lib/directory-queries";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const member = await requireMember();
  const resources = await listResources(member.tier);
  const unlockedIds = resources
    .filter((r) => resourceUnlocked(r, member.tier))
    .map((r) => r.id);

  return (
    <div className="resources-pad">
      <div className="section-header">
        <div>
          <h2>Resources</h2>
          <p>Exclusive tools, guides, and materials for members</p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/resources" label="Add resource" />
        )}
      </div>
      <ResourcesBrowser
        resources={resources}
        unlockedIds={unlockedIds}
        isAdmin={member.isAdmin}
      />
    </div>
  );
}
