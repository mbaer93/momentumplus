import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import { getSpeaker } from "@/lib/directory-queries";
import { listSessions } from "@/lib/sessions/queries";
import { dateLabel } from "@/lib/sessions/view";

export const dynamic = "force-dynamic";

export default async function SpeakerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireMember();
  const speaker = await getSpeaker(params.id);
  if (!speaker) notFound();

  // Sessions by this speaker (matched by placeholder slugs, speaker id, or
  // name). Archived sessions stay out — they're hidden history, not a
  // schedule.
  const all = await listSessions();
  const theirSessions = all.filter(
    (s) =>
      s.status !== "archived" &&
      (speaker.sessionSlugs.includes(s.slug) ||
        s.speaker.id === speaker.id ||
        s.speaker.name === speaker.name),
  );

  return (
    <div className="sess-detail-wrap">
      <Link href="/speakers" className="sess-back">
        <ArrowLeftIcon size={12} /> All speakers
      </Link>

      <div className="spk-hero">
        {speaker.headshotUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            className="spk-hero-av"
            src={speaker.headshotUrl}
            alt={`${speaker.name} headshot`}
            style={{ objectFit: "cover" }}
          />
        ) : (
          <div
            className="spk-hero-av"
            style={{ background: speaker.avatarBg, color: speaker.avatarColor }}
          >
            {speaker.initials}
          </div>
        )}
        <div>
          <div className="spk-hero-name">{speaker.name}</div>
          <div className="spk-hero-title">{speaker.title}</div>
          <div className="spk-hero-tags">
            {speaker.industries.map((tag) => (
              <span className="tag-pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          {speaker.website && (
            <a
              className="sp-link"
              href={speaker.website}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginTop: 10, display: "inline-flex" }}
            >
              Visit website <ExternalIcon size={12} />
            </a>
          )}
        </div>
      </div>

      <div className="spk-body">
        {speaker.bio && <p className="spk-bio">{speaker.bio}</p>}

        <div className="spk-section-title">
          Sessions with {speaker.name.split(" ")[0]}
        </div>
        {theirSessions.length === 0 ? (
          <div className="sess-empty-note">
            No sessions scheduled yet — watch the calendar.
          </div>
        ) : (
          <div className="upcoming-list">
            {theirSessions.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.slug}`}
                className="upcoming-item"
              >
                <div className="upcoming-info">
                  <div className="upcoming-title">{s.title}</div>
                  <div className="upcoming-speaker">
                    {dateLabel(s.startsAt)} · {s.category}
                  </div>
                </div>
                <span
                  className={`status-pill ${
                    s.status === "live"
                      ? "live"
                      : s.status === "completed"
                        ? "attended"
                        : "upcoming"
                  }`}
                >
                  {s.status === "completed" ? "Recorded" : s.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
