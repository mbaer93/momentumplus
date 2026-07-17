import Link from "next/link";
import { ServicesManager } from "@/components/admin/ServicesManager";
import type { EntityRow } from "@/components/admin/EntityManager";
import { ArrowLeftIcon } from "@/components/icons";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminServicesPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  let rows: EntityRow[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("services")
      .select("id, name, tagline, description, url, price_label, sort_order, active")
      .order("sort_order")
      .order("name");
    rows = (data ?? []).map((s) => ({
      id: s.id,
      title: s.name,
      subtitle: s.tagline ?? "",
      badge: s.active ? undefined : "Hidden",
      values: {
        name: s.name,
        tagline: s.tagline ?? "",
        description: s.description ?? "",
        url: s.url ?? "",
        priceLabel: s.price_label ?? "",
        sortOrder: String(s.sort_order ?? 0),
        active: Boolean(s.active),
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
          <h2>Additional Services</h2>
          <p>SLC service offerings shown on the members&apos; Additional Services page</p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: changes persist once Supabase is connected.
        </div>
      )}
      <ServicesManager rows={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
