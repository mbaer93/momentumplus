import Image from "next/image";
import Link from "next/link";
import { listSpeakers } from "@/lib/directory-queries";
import { listAgendaItems } from "@/lib/summit-queries";
import { getSummitSettings } from "@/lib/summit-queries";
import { agendaTimeLabel } from "@/lib/summit";

export const dynamic = "force-dynamic";

export default async function SummitSpeakersPage() {
  const settings = await getSummitSettings();
  const [speakers, agenda] = await Promise.all([
    listSpeakers(),
    listAgendaItems(settings.eventYear),
  ]);
  // "On stage at" chip: this speaker's first agenda slot, if scheduled.
  const slotFor = (speakerId: string) =>
    agenda.find((a) => a.speakerId === speakerId) ?? null;

  return (
    <div className="tsls-pad">
      <div className="tsls-page-header">
        <h2>Speakers</h2>
        <p>Who&apos;s on stage at the summit</p>
      </div>

      {speakers.length === 0 && (
        <div className="tsls-empty">
          Speaker profiles will appear here as they&apos;re announced.
        </div>
      )}

      <div className="tsls-speaker-list">
        {speakers.map((s) => {
          const slot = slotFor(s.id);
          return (
            <Link
              key={s.id}
              href={`/summit/speakers/${s.id}`}
              className="tsls-speaker-row"
            >
              {s.headshotUrl ? (
                <Image
                  src={s.headshotUrl}
                  alt={`${s.name} headshot`}
                  width={52}
                  height={52}
                  className="tsls-speaker-av"
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <div
                  className="tsls-speaker-av"
                  style={{ background: s.avatarBg, color: s.avatarColor }}
                >
                  {s.initials}
                </div>
              )}
              <div className="tsls-speaker-info">
                <div className="tsls-speaker-name">{s.name}</div>
                <div className="tsls-speaker-title">{s.title}</div>
                {slot && (
                  <div className="tsls-speaker-slot">
                    On stage {agendaTimeLabel(slot.startsAt)}
                    {slot.location ? ` · ${slot.location}` : ""}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
