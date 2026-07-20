import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSpeaker } from "@/lib/directory-queries";
import { agendaTimeLabel } from "@/lib/summit";
import { getSummitSettings, listAgendaItems } from "@/lib/summit-queries";

export const dynamic = "force-dynamic";

export default async function SummitSpeakerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const speaker = await getSpeaker(params.id);
  if (!speaker) notFound();

  const settings = await getSummitSettings();
  const agenda = await listAgendaItems(settings.eventYear);
  const slots = agenda.filter((a) => a.speakerId === speaker.id);

  return (
    <div className="tsls-pad">
      <Link href="/summit/speakers" className="tsls-back">
        ← All speakers
      </Link>

      <div className="tsls-speaker-hero">
        {speaker.headshotUrl ? (
          <Image
            src={speaker.headshotUrl}
            alt={`${speaker.name} headshot`}
            width={88}
            height={88}
            className="tsls-speaker-hero-av"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <div
            className="tsls-speaker-hero-av"
            style={{ background: speaker.avatarBg, color: speaker.avatarColor }}
          >
            {speaker.initials}
          </div>
        )}
        <div>
          <h2 className="tsls-speaker-hero-name">{speaker.name}</h2>
          <div className="tsls-speaker-hero-title">{speaker.title}</div>
          <div className="tsls-speaker-tags">
            {speaker.industries.map((tag) => (
              <span className="tag-pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {slots.length > 0 && (
        <section className="tsls-card">
          <h3>On stage</h3>
          {slots.map((slot) => (
            <div key={slot.id} className="tsls-slot-row">
              <div className="tsls-slot-time">{agendaTimeLabel(slot.startsAt)}</div>
              <div>
                <div className="tsls-slot-title">{slot.title}</div>
                {slot.location && (
                  <div className="tsls-slot-loc">{slot.location}</div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {speaker.bio && (
        <section className="tsls-card">
          <h3>About</h3>
          <p className="tsls-bio">{speaker.bio}</p>
        </section>
      )}

      {speaker.website && (
        <a
          className="tsls-outline-btn"
          href={speaker.website}
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit website
        </a>
      )}
    </div>
  );
}
