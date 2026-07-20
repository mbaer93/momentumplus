import { CommunityView } from "@/components/community/CommunityView";
import { requireMember } from "@/lib/current-member";
import { listEventSpeakers } from "@/lib/event-speakers";
import { channelsForTicket, EVENT_CHANNELS, isStreamConfigured } from "@/lib/stream";
import { agendaTimeLabel, currentAndNext, isVipRegistration } from "@/lib/summit";
import {
  getMyTicket,
  getSummitSettings,
  listAgendaItems,
} from "@/lib/summit-queries";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * The event's own community — its own Stream app, entirely separate from
 * Momentum+. Channels are event-scoped; the VIP lounge unlocks with a VIP
 * ticket. The sidebar card highlights what's happening at the venue.
 */
export default async function CommunityPage() {
  const member = await requireMember();
  const settings = await getSummitSettings();
  const [ticket, speakers, agenda] = await Promise.all([
    getMyTicket(),
    listEventSpeakers(),
    listAgendaItems(settings.eventYear),
  ]);

  const isVip = Boolean(ticket && isVipRegistration(ticket.registrationType));
  const allowedIds = new Set(
    channelsForTicket({ isVip, isAdmin: member.isAdmin }).map((c) => c.id),
  );
  const channels = EVENT_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    adminPostOnly: Boolean(c.adminPostOnly),
    allowed: allowedIds.has(c.id),
    lockLabel: c.gate === "vip" ? "VIP" : undefined,
  }));

  const { current, next } = currentAndNext(agenda);
  const highlight = current ?? next;

  return (
    <div className="tsls-community">
      <CommunityView
        channels={channels}
        memberName={member.name}
        memberInitials={member.initials}
        isAdmin={member.isAdmin}
        adminTitle={member.isAdmin ? "TSLS Team" : null}
        streamConfigured={isStreamConfigured()}
        preview={!isSupabaseConfigured()}
        speakers={speakers.map((s) => ({ id: s.id, name: s.name }))}
        nextSession={
          highlight
            ? {
                dateLabel: current ? "NOW" : "NEXT",
                title: highlight.title,
                meta: `${agendaTimeLabel(highlight.startsAt)}${
                  highlight.location ? ` · ${highlight.location}` : ""
                }`,
              }
            : {
                dateLabel: "TSLS",
                title: settings.name,
                meta: settings.hoursLabel,
              }
        }
      />
    </div>
  );
}
