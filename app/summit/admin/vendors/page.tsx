import Link from "next/link";
import { VendorsManager } from "@/components/summit/VendorsManager";
import type { EntityRow } from "@/components/admin/EntityManager";
import { getSummitSettings } from "@/lib/summit-queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function SummitAdminVendorsPage() {
  const settings = await getSummitSettings();
  let rows: EntityRow[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("vendors")
      .select(
        "id, name, tagline, description, category, booth, website, logo_url, offer, sort_order, active",
      )
      .eq("event_year", settings.eventYear)
      .order("sort_order")
      .order("name");
    rows = (data ?? []).map((v) => ({
      id: v.id as string,
      title: v.name as string,
      subtitle: [v.category, v.booth].filter(Boolean).join(" · "),
      badge: v.active ? undefined : "Hidden",
      values: {
        name: v.name as string,
        tagline: (v.tagline as string) ?? "",
        category: (v.category as string) ?? "",
        booth: (v.booth as string) ?? "",
        website: (v.website as string) ?? "",
        logoUrl: (v.logo_url as string) ?? "",
        offer: (v.offer as string) ?? "",
        description: (v.description as string) ?? "",
        sortOrder: String(v.sort_order ?? 0),
        active: Boolean(v.active),
      },
    }));
  }

  return (
    <div className="tsls-pad">
      <Link href="/summit/admin" className="tsls-back">
        ← Summit Admin
      </Link>
      <div className="tsls-page-header">
        <h2>Vendors · {settings.eventYear}</h2>
        <p>Booths and attendee offers shown in the companion app</p>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: changes persist once Supabase is connected.
        </div>
      )}
      <VendorsManager rows={rows} eventYear={settings.eventYear} />
    </div>
  );
}
