import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { AdminEditChip } from "@/components/admin/AdminChips";
import { SponsorMark } from "@/components/sponsors/SponsorMark";
import { SponsorWebsiteLink } from "@/components/sponsors/SponsorWebsiteLink";
import { requireMember } from "@/lib/current-member";
import { getSponsor } from "@/lib/directory-queries";
import { sponsorTierLabel } from "@/lib/sponsor-tiers";

export const dynamic = "force-dynamic";

/*
 * Full-page sponsor profile — same idea as a speaker's page: logo hero,
 * tier, tagline, long-form about text, the member offer, and the tracked
 * website link.
 */
export default async function SponsorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const member = await requireMember();
  const sponsor = await getSponsor(params.id);
  if (!sponsor) notFound();

  return (
    <div className="sess-detail-wrap">
      <Link href="/sponsors" className="sess-back">
        <ArrowLeftIcon size={12} /> All sponsors
      </Link>

      <div className="spk-hero" style={{ position: "relative" }}>
        {member.isAdmin && (
          <span className="admin-chip-overlay">
            <AdminEditChip href={`/admin/sponsors?edit=${sponsor.id}`} />
          </span>
        )}
        <div
          className="spk-hero-av"
          style={{
            background: "#fff",
            border: "1px solid var(--warm-gray)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
            borderRadius: 4,
          }}
        >
          <SponsorMark
            name={sponsor.name}
            logoUrl={sponsor.logoUrl}
            wordmark={sponsor.wordmark}
            maxHeight={72}
          />
        </div>
        <div>
          <div className="spk-hero-tags" style={{ marginBottom: 6 }}>
            <span className="tag-pill">{sponsorTierLabel(sponsor.tier)}</span>
          </div>
          <div className="spk-hero-name">{sponsor.name}</div>
          {sponsor.tagline && (
            <div className="spk-hero-title">{sponsor.tagline}</div>
          )}
          {sponsor.website && sponsor.website !== "#" && (
            <div style={{ marginTop: 10 }}>
              <SponsorWebsiteLink sponsorId={sponsor.id} href={sponsor.website} />
            </div>
          )}
        </div>
      </div>

      <div className="spk-body">
        {sponsor.description ? (
          sponsor.description
            .split(/\n{2,}/)
            .map((para, i) => (
              <p className="spk-bio" key={i}>
                {para}
              </p>
            ))
        ) : (
          <p className="spk-bio" style={{ color: "var(--mid-gray)" }}>
            {sponsor.tagline ||
              `${sponsor.name} is a proud ${sponsorTierLabel(sponsor.tier)} of Momentum+.`}
          </p>
        )}

        {sponsor.offer && (
          <>
            <div className="spk-section-title">Member offer</div>
            <div className="sp-offer-box" style={{ maxWidth: 480 }}>
              <strong>Exclusive for Momentum+ members</strong>
              {sponsor.offer}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
