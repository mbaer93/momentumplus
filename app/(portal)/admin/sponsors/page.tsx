import Link from "next/link";
import {
  SponsorsManager,
  type AdminSponsorRow,
} from "@/components/admin/SponsorsManager";
import { ArrowLeftIcon } from "@/components/icons";
import { sponsors as placeholderSponsors } from "@/lib/directory-data";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminSponsorsPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  let rows: AdminSponsorRow[] = placeholderSponsors.map((s, i) => ({
    id: s.id,
    name: s.name,
    tier: s.tier,
    tagline: s.tagline,
    offer: s.offer ?? "",
    website: s.website,
    logoUrl: s.logoUrl,
    sidebarAdUrl: s.sidebarAdUrl,
    railActive: s.railActive,
    impressions: [4820, 3105, 2988, 1450, 1211, 976][i] ?? 0,
    clicks: [212, 148, 131, 64, 51, 38][i] ?? 0,
  }));

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const [{ data: sponsors }, { data: events }] = await Promise.all([
      admin
        .from("sponsors")
        .select(
          "id, name, tier, tagline, offer, website, logo_url, sidebar_ad_url, rail_active",
        )
        .order("tier"),
      admin.from("sponsor_events").select("sponsor_id, kind"),
    ]);
    if (sponsors) {
      const counts = new Map<string, { impressions: number; clicks: number }>();
      for (const e of events ?? []) {
        const c = counts.get(e.sponsor_id) ?? { impressions: 0, clicks: 0 };
        if (e.kind === "click") c.clicks++;
        else c.impressions++;
        counts.set(e.sponsor_id, c);
      }
      rows = sponsors.map((s) => ({
        id: s.id,
        name: s.name,
        tier: s.tier,
        tagline: s.tagline ?? "",
        offer: s.offer ?? "",
        website: s.website ?? "",
        logoUrl: s.logo_url ?? null,
        sidebarAdUrl: s.sidebar_ad_url ?? null,
        railActive: Boolean(s.rail_active),
        impressions: counts.get(s.id)?.impressions ?? 0,
        clicks: counts.get(s.id)?.clicks ?? 0,
      }));
    }
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Sponsors</h2>
          <p>Partners, rail placement, and performance</p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: sample sponsors with illustrative impression/click
          counts. Real counts come from sponsor_events once connected.
        </div>
      )}
      <SponsorsManager sponsors={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
