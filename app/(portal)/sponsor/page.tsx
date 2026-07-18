import Link from "next/link";
import { SponsorStudioView } from "@/components/sponsor/SponsorStudioView";
import { getAdminAccess } from "@/lib/auth-helpers";
import { requireMember } from "@/lib/current-member";
import { sponsorTierLabel } from "@/lib/sponsor-tiers";
import {
  listSponsorTeam,
  sponsorTicketAllotment,
  ticketsUsed,
  type SponsorRole,
} from "@/lib/sponsor-team";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Sponsor Studio: where the people who run a sponsor page manage it.
 * Owners edit the page, hand out VIP tickets, manage co-managers, and can
 * transfer ownership; managers edit the page. Super Admins can open any
 * sponsor's studio via ?sponsor=<id>.
 */
export default async function SponsorStudioPage({
  searchParams,
}: {
  searchParams: { sponsor?: string };
}) {
  await requireMember();

  if (!isSupabaseConfigured()) {
    return (
      <div className="admin-pad">
        <div className="section-header">
          <div>
            <h2>Sponsor Studio</h2>
            <p>Preview mode — connect Supabase to manage a sponsor page.</p>
          </div>
        </div>
      </div>
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createServiceClient();
  const access = await getAdminAccess();
  const isSuperAdmin = access?.role === "super";

  // Which sponsor? Own seat first; Super Admins may target any sponsor.
  let sponsorId: string | null = null;
  let viewerRole: SponsorRole | null = null;
  const { data: seats } = await admin
    .from("sponsor_members")
    .select("sponsor_id, role")
    .eq("profile_id", user.id)
    .in("role", ["owner", "manager"]);
  if (isSuperAdmin && searchParams.sponsor) {
    sponsorId = searchParams.sponsor;
    viewerRole =
      (seats ?? []).find((s) => s.sponsor_id === sponsorId)?.role as
        | SponsorRole
        | undefined ?? null;
  } else if (seats?.length) {
    // Owner seat wins if they hold several.
    const best =
      seats.find((s) => (s.role as string) === "owner") ?? seats[0];
    sponsorId = best.sponsor_id as string;
    viewerRole = best.role as SponsorRole;
  }

  if (!sponsorId) {
    return (
      <div className="admin-pad">
        <div className="section-header">
          <div>
            <h2>Sponsor Studio</h2>
            <p>You don&apos;t manage a sponsor page</p>
          </div>
        </div>
        <div className="sessions-empty">
          This area is for the people who run a sponsor page. Interested in
          sponsoring? <Link href="/sponsors">See our current sponsors</Link>{" "}
          and reach out to the Momentum+ team.
        </div>
      </div>
    );
  }

  const { data: sponsor } = await admin
    .from("sponsors")
    .select(
      "id, name, tier, tagline, description, offer, website, expires_at, archived_at",
    )
    .eq("id", sponsorId)
    .maybeSingle();
  if (!sponsor) {
    return (
      <div className="admin-pad">
        <div className="sessions-empty">That sponsor page no longer exists.</div>
      </div>
    );
  }

  const [team, allotment] = await Promise.all([
    listSponsorTeam(sponsorId),
    sponsorTicketAllotment(sponsorId),
  ]);
  const used = ticketsUsed(team);
  const canOwn = isSuperAdmin || viewerRole === "owner";

  return (
    <SponsorStudioView
      sponsor={{
        id: sponsor.id as string,
        name: sponsor.name as string,
        tierLabel: sponsorTierLabel((sponsor.tier as string) ?? "partner"),
        tagline: (sponsor.tagline as string) ?? "",
        description: (sponsor.description as string) ?? "",
        offer: (sponsor.offer as string) ?? "",
        website: (sponsor.website as string) ?? "",
        archived: Boolean(sponsor.archived_at),
        expiresLabel: sponsor.expires_at
          ? new Date(sponsor.expires_at as string).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : null,
      }}
      team={team}
      viewerProfileId={user.id}
      isOwner={canOwn}
      isSuperAdmin={isSuperAdmin}
      ticketAllotment={allotment}
      ticketsUsed={used}
    />
  );
}
