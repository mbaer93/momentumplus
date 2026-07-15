import Link from "next/link";
import { ResourcesManager } from "@/components/admin/ResourcesManager";
import type { EntityRow } from "@/components/admin/EntityManager";
import { ArrowLeftIcon } from "@/components/icons";
import { resources as placeholderResources } from "@/lib/directory-data";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminResourcesPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  let rows: EntityRow[] = placeholderResources.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.type,
    badge: r.minAccess === "vip_plus" ? "VIP+" : undefined,
    values: {
      title: r.title,
      category: r.tags[0] ?? "",
      partnerName: r.tags[1] ?? "",
      url: r.url,
      description: r.description,
      minAccess: r.minAccess,
      active: true,
    },
  }));

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("resources")
      .select("id, title, category, description, url, partner_name, min_access, active")
      .order("title");
    rows = (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: [r.category, r.partner_name].filter(Boolean).join(" · "),
      badge: !r.active
        ? "Inactive"
        : r.min_access === "vip_plus"
          ? "VIP+"
          : undefined,
      values: {
        title: r.title,
        category: r.category ?? "",
        partnerName: r.partner_name ?? "",
        url: r.url ?? "",
        description: r.description ?? "",
        minAccess: r.min_access,
        active: Boolean(r.active),
      },
    }));
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Resources</h2>
          <p>Tools, guides, and partner materials for members</p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: sample resources. Changes persist once Supabase is
          connected.
        </div>
      )}
      <ResourcesManager rows={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
