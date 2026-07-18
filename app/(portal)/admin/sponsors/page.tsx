import Link from "next/link";
import {
  SponsorsManager,
  type AdminSponsorRow,
} from "@/components/admin/SponsorsManager";
import { SponsorTicketSettings } from "@/components/admin/SponsorTicketSettings";
import { ArrowLeftIcon } from "@/components/icons";
import { getAdminAccess } from "@/lib/auth-helpers";
import { sponsors as placeholderSponsors } from "@/lib/directory-data";
import { getPresentedByLogoUrl } from "@/lib/presented-by";
import { getTicketCounts } from "@/lib/sponsor-team";
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
    description: s.description,
    offer: s.offer ?? "",
    website: s.website,
    logoUrl: s.logoUrl,
    sidebarAdUrl: s.sidebarAdUrl,
    railActive: s.railActive,
    impressions: [4820, 3105, 2988, 1450, 1211, 976][i] ?? 0,
    clicks: [212, 148, 131, 64, 51, 38][i] ?? 0,
    seats: [],
  }));

  let pastRows: AdminSponsorRow[] = [];
  let pendingInvites: { email: string; tier: string; businessName: string; createdAt: string }[] = [];
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const [{ data: sponsors }, { data: events }, { data: seatRows }, { data: inviteRows }] =
      await Promise.all([
        admin
          .from("sponsors")
          .select(
            "id, name, tier, tagline, description, offer, website, logo_url, sidebar_ad_url, rail_active, expires_at, archived_at",
          )
          .order("tier")
          .then((res) =>
            // Pre-migration fallback: description arrives with 0033.
            res.data
              ? res
              : admin
                  .from("sponsors")
                  .select(
                    "id, name, tier, tagline, offer, website, logo_url, sidebar_ad_url, rail_active, expires_at, archived_at",
                  )
                  .order("tier"),
          ),
        admin.from("sponsor_events").select("sponsor_id, kind"),
        admin
          .from("sponsor_members")
          .select("sponsor_id, profile_id, profiles ( full_name, email )"),
        admin
          .from("sponsor_invites")
          .select("email, tier, business_name, created_at")
          .is("completed_at", null)
          .order("created_at", { ascending: false }),
      ]);
    pendingInvites = (inviteRows ?? []).map((i) => ({
      email: i.email as string,
      tier: i.tier as string,
      businessName: (i.business_name as string) ?? "",
      createdAt: i.created_at as string,
    }));
    if (sponsors) {
      const counts = new Map<string, { impressions: number; clicks: number }>();
      for (const e of events ?? []) {
        const c = counts.get(e.sponsor_id) ?? { impressions: 0, clicks: 0 };
        if (e.kind === "click") c.clicks++;
        else c.impressions++;
        counts.set(e.sponsor_id, c);
      }
      const seatsBySponsor = new Map<
        string,
        { profileId: string; name: string; email: string }[]
      >();
      for (const seat of seatRows ?? []) {
        const p = (
          seat as unknown as {
            profiles: { full_name: string | null; email: string | null } | null;
          }
        ).profiles;
        const list = seatsBySponsor.get(seat.sponsor_id) ?? [];
        list.push({
          profileId: seat.profile_id,
          name: p?.full_name ?? "",
          email: p?.email ?? "",
        });
        seatsBySponsor.set(seat.sponsor_id, list);
      }
      const mapRow = (s: (typeof sponsors)[number]): AdminSponsorRow => ({
        id: s.id,
        name: s.name,
        tier: s.tier,
        tagline: s.tagline ?? "",
        description: (s as { description?: string | null }).description ?? "",
        offer: s.offer ?? "",
        website: s.website ?? "",
        logoUrl: s.logo_url ?? null,
        sidebarAdUrl: s.sidebar_ad_url ?? null,
        railActive: Boolean(s.rail_active),
        impressions: counts.get(s.id)?.impressions ?? 0,
        clicks: counts.get(s.id)?.clicks ?? 0,
        seats: seatsBySponsor.get(s.id) ?? [],
        expiresAt: (s as { expires_at?: string | null }).expires_at ?? null,
        archivedAt: (s as { archived_at?: string | null }).archived_at ?? null,
      });
      const now = Date.now();
      const isPast = (s: (typeof sponsors)[number]) => {
        const row = s as { archived_at?: string | null; expires_at?: string | null };
        return Boolean(
          row.archived_at ||
            (row.expires_at && new Date(row.expires_at).getTime() <= now),
        );
      };
      rows = sponsors.filter((s) => !isPast(s)).map(mapRow);
      pastRows = sponsors.filter(isPast).map(mapRow);
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
      <SponsorsManager
        sponsors={rows}
        pastSponsors={pastRows}
        pendingInvites={pendingInvites}
        presentedByLogoUrl={await getPresentedByLogoUrl()}
        initialEditId={searchParams?.edit}
      />
      <SponsorTicketSettings
        counts={
          isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY
            ? await getTicketCounts()
            : {}
        }
        sponsors={rows.map((r) => ({ id: r.id, name: r.name }))}
        isSuperAdmin={(await getAdminAccess())?.role === "super"}
      />
    </div>
  );
}
