import { ArrowUpRightIcon, MapPinIcon } from "@/components/summit/icons";
import { requireMember } from "@/lib/current-member";
import { qrSvg } from "@/lib/qr";
import {
  isVipRegistration,
  momentumGiftMonths,
  ticketQrPayload,
  ticketTypeLabel,
} from "@/lib/summit";
import { getMyTicket, getSummitSettings } from "@/lib/summit-queries";

export const dynamic = "force-dynamic";

/*
 * My Ticket — the screen attendees pull up at the door. The ticket record
 * comes from this app's attendees ledger (filled by the read-only Sheet
 * importer); the QR encodes the same email the registration sheet keys on,
 * so staff can match it against the registration list.
 *
 * Momentum+ is mentioned NOWHERE on this screen until the on-stage
 * announcement flips settings.momentumAnnounced.
 */
export default async function TicketPage() {
  const member = await requireMember();
  const settings = await getSummitSettings();
  const ticket = await getMyTicket();

  const upgradeHref = settings.upgradeUrl || settings.registrationUrl;
  const dateLabel = new Date(`${settings.startDate}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" },
  );

  if (!ticket) {
    return (
      <div className="tsls-pad">
        <div className="tsls-page-header">
          <h2>My Ticket</h2>
        </div>
        <div className="tsls-empty">
          <p style={{ marginBottom: 10 }}>
            We couldn&apos;t find a summit registration linked to this account
            yet. If you registered with a different email, or registered in the
            last half hour, it may still be syncing.
          </p>
          <a
            className="tsls-gold-btn"
            href={settings.registrationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Register for the summit
            <ArrowUpRightIcon size={14} />
          </a>
        </div>
      </div>
    );
  }

  const vip = isVipRegistration(ticket.registrationType);
  const giftMonths = momentumGiftMonths(ticket.registrationType);
  const svg = qrSvg(
    ticketQrPayload(ticket, member.email),
    `Check-in code for ${member.name}`,
  );

  return (
    <div className="tsls-pad">
      <div className="tsls-page-header">
        <h2>My Ticket</h2>
        <p>Show this at check-in</p>
      </div>

      <div className={`tsls-ticket${vip ? " vip" : ""}`}>
        <div className="tsls-ticket-head">
          <div className="tsls-ticket-event">
            TSLS {ticket.eventYear}
            {vip && <span className="tsls-vip-badge">VIP</span>}
          </div>
          <div className="tsls-ticket-type">
            {ticketTypeLabel(ticket.registrationType)}
          </div>
        </div>
        <div
          className="tsls-ticket-qr"
          // Server-generated static SVG from qrcode-generator — no user markup.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="tsls-ticket-holder">
          <div className="tsls-ticket-name">{member.name}</div>
          <div className="tsls-ticket-email">{member.email}</div>
        </div>
        <div className="tsls-ticket-rip" aria-hidden />
        <div className="tsls-ticket-meta">
          <span>{dateLabel}</span>
          <span>{settings.hoursLabel}</span>
          <span className="tsls-ticket-venue">
            <MapPinIcon size={12} /> {settings.venue}
          </span>
        </div>
      </div>

      {!vip && (
        <div className="tsls-upgrade-card">
          <div>
            <div className="tsls-upgrade-title">VIP Leadership Experience</div>
            <p>
              Upgrade your ticket to the VIP Leadership Experience for the
              full summit — premium access all day.
            </p>
          </div>
          <a
            className="tsls-gold-btn"
            href={upgradeHref}
            target="_blank"
            rel="noreferrer"
          >
            Upgrade my ticket
            <ArrowUpRightIcon size={14} />
          </a>
        </div>
      )}

      {settings.momentumAnnounced && (
        <div className="tsls-upgrade-card" style={{ borderColor: "var(--navy)" }}>
          <div>
            <div className="tsls-upgrade-title">
              Included: {giftMonths} {giftMonths === 1 ? "month" : "months"} of
              Momentum+
            </div>
            <p>
              As announced on stage — your ticket includes member-level access
              to Momentum+, the year-round leadership platform. Watch your
              inbox for your invite.
            </p>
          </div>
        </div>
      )}

      <p className="tsls-ticket-note">
        Registered{" "}
        {new Date(ticket.registeredAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        . Questions about your registration? Ask at the check-in desk or reply
        to your confirmation email.
      </p>
    </div>
  );
}
