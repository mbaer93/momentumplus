import Image from "next/image";
import Link from "next/link";
import { requireMember } from "@/lib/current-member";
import {
  listSpeakers,
  listSpeakersNextSeason,
} from "@/lib/directory-queries";
import { listSessions } from "@/lib/sessions/queries";
import { upcomingSeasonStart } from "@/lib/sponsor-lifecycle";
import { AdminAddChip, AdminEditChip } from "@/components/admin/AdminChips";
import { SeasonToggle } from "@/components/directory/SeasonToggle";
import { BodyAd } from "@/components/sponsors/BodyAd";

export const dynamic = "force-dynamic";

export default async function SpeakersPage({
  searchParams,
}: {
  searchParams?: { season?: string };
}) {
  const member = await requireMember();
  // Next-season preview is for the people planning it — admins, speakers,
  // sponsor managers. Members always get the live season.
  const canPreview =
    member.isAdmin || member.isSpeaker || member.isSponsorManager;
  const nextView = canPreview && searchParams?.season === "next";
  const boundaryYear = upcomingSeasonStart().getUTCFullYear();
  const [speakers, sessions] = await Promise.all([
    nextView ? listSpeakersNextSeason() : listSpeakers(),
    listSessions(),
  ]);
  // Real per-speaker session counts (the directory rows don't carry them) —
  // archived sessions don't count toward a speaker's tally.
  const countFor = (sp: { id: string; name: string }) =>
    sessions.filter(
      (s) =>
        s.status !== "archived" &&
        (s.speaker.id === sp.id || s.speaker.name === sp.name),
    ).length;

  return (
    <div className="speakers-pad">
      <div className="section-header">
        <div>
          <h2>Our Speakers</h2>
          <p>World-class coaches and thought leaders</p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/speakers" label="Add speaker" />
        )}
      </div>
      {canPreview && (
        <SeasonToggle
          base="/speakers"
          next={nextView}
          nextLabel={`Oct 1, ${boundaryYear} – Oct 1, ${boundaryYear + 1}`}
        />
      )}
      {speakers.length === 0 && (
        <div className="sessions-empty" style={{ marginTop: 20 }}>
          {nextView
            ? "No speakers confirmed for next season yet — they appear here as they complete onboarding."
            : "Speaker profiles will appear here as they're added."}
        </div>
      )}
      <BodyAd variant="tile" />
      <div className="speakers-grid">
        {speakers.map((s) => (
          <div key={s.id} style={{ position: "relative" }}>
            {member.isAdmin && (
              <span className="admin-chip-overlay">
                <AdminEditChip href={`/admin/speakers?edit=${s.id}`} />
              </span>
            )}
          <Link href={`/speakers/${s.id}`} className="speaker-card">
            <div
              className="speaker-card-banner"
              style={{ background: s.bannerGradient }}
            >
              {s.headshotUrl ? (
                <Image
                  className="speaker-card-av"
                  src={s.headshotUrl}
                  alt={`${s.name} headshot`}
                  width={120}
                  height={120}
                  sizes="120px"
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <div
                  className="speaker-card-av"
                  style={{ background: s.avatarBg, color: s.avatarColor }}
                >
                  {s.initials}
                </div>
              )}
            </div>
            <div className="speaker-card-body">
              <div className="speaker-card-name">{s.name}</div>
              <div className="speaker-card-title">{s.title}</div>
              <div className="speaker-card-tags">
                {s.industries.map((tag) => (
                  <span className="tag-pill" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="speaker-card-footer">
              <div className="speaker-stat">
                Member since <strong>{s.memberSince}</strong>
              </div>
              <div className="speaker-stat">
                <strong>{countFor(s)}</strong> session
                {countFor(s) === 1 ? "" : "s"}
              </div>
            </div>
          </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
