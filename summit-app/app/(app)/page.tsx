import Link from "next/link";
import {
  AgendaIcon,
  ArrowUpRightIcon,
  CommunityChatIcon,
  MapPinIcon,
  SpeakersMicIcon,
  TicketIcon,
  VendorsIcon,
} from "@/components/summit/icons";
import { requireMember } from "@/lib/current-member";
import { momentumUrl } from "@/lib/momentum";
import {
  agendaTimeLabel,
  currentAndNext,
  isVipRegistration,
  momentumGiftMonths,
  ticketTypeLabel,
} from "@/lib/summit";
import {
  getMyTicket,
  getSummitSettings,
  listAgendaItems,
} from "@/lib/summit-queries";

export const dynamic = "force-dynamic";

function eventDatesLabel(startDate: string, endDate: string): string {
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
}

export default async function HomePage() {
  const member = await requireMember();
  const settings = await getSummitSettings();
  const [agenda, ticket] = await Promise.all([
    listAgendaItems(settings.eventYear),
    getMyTicket(),
  ]);
  const { current, next } = currentAndNext(agenda);
  const firstName = member.name.split(" ")[0];

  const tiles = [
    {
      href: "/agenda",
      icon: AgendaIcon,
      title: "Agenda",
      desc: "The full day, hour by hour",
    },
    {
      href: "/speakers",
      icon: SpeakersMicIcon,
      title: "Speakers",
      desc: "Who's on stage",
    },
    {
      href: "/vendors",
      icon: VendorsIcon,
      title: "Vendors",
      desc: "Booths and attendee offers",
    },
    {
      href: "/community",
      icon: CommunityChatIcon,
      title: "Community",
      desc: "Chat with fellow attendees",
    },
    {
      href: "/ticket",
      icon: TicketIcon,
      title: "My Ticket",
      desc: ticket
        ? ticketTypeLabel(ticket.registrationType)
        : "Registration & check-in",
      badge:
        ticket && isVipRegistration(ticket.registrationType) ? "VIP" : undefined,
    },
  ];

  return (
    <div className="tsls-pad">
      <section className="tsls-hero">
        <div className="tsls-hero-kicker">Welcome, {firstName}</div>
        <h1 className="tsls-hero-title">{settings.name}</h1>
        <p className="tsls-hero-tagline">{settings.tagline}</p>
        <div className="tsls-hero-meta">
          <span>{eventDatesLabel(settings.startDate, settings.endDate)}</span>
          <span>{settings.hoursLabel}</span>
        </div>
        <a
          className="tsls-hero-venue"
          href={`https://maps.google.com/?q=${encodeURIComponent(
            `${settings.venue}, ${settings.address}`,
          )}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPinIcon size={14} />
          {settings.venue} · {settings.address}
        </a>
      </section>

      {(current || next) && (
        <section className="tsls-now-card">
          {current && (
            <div className="tsls-now-row">
              <span className="tsls-now-badge live">Happening now</span>
              <div>
                <div className="tsls-now-title">{current.title}</div>
                <div className="tsls-now-meta">
                  {agendaTimeLabel(current.startsAt)}
                  {current.location ? ` · ${current.location}` : ""}
                </div>
              </div>
            </div>
          )}
          {next && (
            <div className="tsls-now-row">
              <span className="tsls-now-badge">Up next</span>
              <div>
                <div className="tsls-now-title">{next.title}</div>
                <div className="tsls-now-meta">
                  {agendaTimeLabel(next.startsAt)}
                  {next.location ? ` · ${next.location}` : ""}
                </div>
              </div>
            </div>
          )}
          <Link href="/agenda" className="tsls-now-link">
            Full agenda
          </Link>
        </section>
      )}

      <section className="tsls-tile-grid">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className="tsls-tile">
              <span className="tsls-tile-icon">
                <Icon size={20} />
              </span>
              <span className="tsls-tile-body">
                <span className="tsls-tile-title">
                  {t.title}
                  {t.badge && <span className="tsls-vip-badge">{t.badge}</span>}
                </span>
                <span className="tsls-tile-desc">{t.desc}</span>
              </span>
            </Link>
          );
        })}
      </section>

      {/* The Momentum+ gift stays invisible until it's announced on stage —
          then this card is the reveal. TSLS pushes to Momentum+, never the
          other way around. */}
      {settings.momentumAnnounced && ticket && (
        <section className="tsls-momentum-card">
          <div>
            <div className="tsls-momentum-title">
              Your gift: Momentum<span>+</span>
            </div>
            <p>
              Your {ticketTypeLabel(ticket.registrationType)} ticket includes{" "}
              {momentumGiftMonths(ticket.registrationType)}{" "}
              {momentumGiftMonths(ticket.registrationType) === 1
                ? "month"
                : "months"}{" "}
              of Momentum+ member access — sessions, recordings, and a
              year-round leadership community. Watch your inbox for your
              invite.
            </p>
          </div>
          <a href={momentumUrl("/dashboard")} className="tsls-momentum-cta">
            Claim your access
            <ArrowUpRightIcon size={14} />
          </a>
        </section>
      )}

      <div className="tsls-footer-links">
        <a href={settings.websiteUrl} target="_blank" rel="noreferrer">
          Event website
        </a>
        <a href={settings.registrationUrl} target="_blank" rel="noreferrer">
          Registration
        </a>
      </div>
    </div>
  );
}
