import Link from "next/link";
import {
  AGENDA_KIND_LABELS,
  agendaStatus,
  agendaTimeLabel,
  groupAgendaByDay,
} from "@/lib/summit";
import { getSummitSettings, listAgendaItems } from "@/lib/summit-queries";

export const dynamic = "force-dynamic";

export default async function SummitAgendaPage() {
  const settings = await getSummitSettings();
  const items = await listAgendaItems(settings.eventYear);
  const days = groupAgendaByDay(items);
  const now = Date.now();

  return (
    <div className="tsls-pad">
      <div className="tsls-page-header">
        <h2>Agenda</h2>
        <p>
          All times Eastern · {settings.venue}
        </p>
      </div>

      {days.length === 0 && (
        <div className="tsls-empty">
          The day-of schedule will appear here as soon as it&apos;s published.
          Check the{" "}
          <a href={settings.websiteUrl} target="_blank" rel="noreferrer">
            event website
          </a>{" "}
          in the meantime.
        </div>
      )}

      {days.map((day) => (
        <section key={day.key} className="tsls-agenda-day">
          {days.length > 1 && <h3 className="tsls-agenda-day-label">{day.label}</h3>}
          <ol className="tsls-agenda-list">
            {day.items.map((item) => {
              const status = agendaStatus(item, now);
              const kindLabel = AGENDA_KIND_LABELS[item.kind];
              return (
                <li
                  key={item.id}
                  className={`tsls-agenda-item ${status}${item.vipOnly ? " vip" : ""}`}
                >
                  <div className="tsls-agenda-time">
                    <span>{agendaTimeLabel(item.startsAt)}</span>
                    {item.endsAt && <span className="end">{agendaTimeLabel(item.endsAt)}</span>}
                  </div>
                  <div className="tsls-agenda-body">
                    <div className="tsls-agenda-toprow">
                      {kindLabel && (
                        <span className={`tsls-kind-badge ${item.kind}`}>{kindLabel}</span>
                      )}
                      {item.vipOnly && <span className="tsls-vip-badge">VIP</span>}
                      {status === "live" && (
                        <span className="tsls-live-badge">Now</span>
                      )}
                      {item.track && <span className="tsls-track-label">{item.track}</span>}
                    </div>
                    <div className="tsls-agenda-title">{item.title}</div>
                    {item.speakerName && (
                      <div className="tsls-agenda-speaker">
                        {item.speakerId ? (
                          <Link href={`/summit/speakers/${item.speakerId}`}>
                            {item.speakerName}
                          </Link>
                        ) : (
                          item.speakerName
                        )}
                      </div>
                    )}
                    {item.description && (
                      <p className="tsls-agenda-desc">{item.description}</p>
                    )}
                    {item.location && (
                      <div className="tsls-agenda-loc">{item.location}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
