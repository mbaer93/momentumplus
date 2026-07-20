import { CommunityView } from "@/components/community/CommunityView";
import { requireMember } from "@/lib/current-member";
import { listSpeakers } from "@/lib/directory-queries";
import { agendaTimeLabel, currentAndNext } from "@/lib/summit";
import { getSummitSettings, listAgendaItems } from "@/lib/summit-queries";
import { COMMUNITY_CHANNELS, channelsForTier, isStreamConfigured } from "@/lib/stream";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * The same community the Momentum+ portal uses (one Stream workspace, one
 * member base) mounted inside the summit shell, so attendees chat without
 * leaving the event companion. Wiring mirrors /(portal)/community/page.tsx;
 * the sidebar card highlights what's happening at the venue instead of the
 * next portal session.
 */
export default async function SummitCommunityPage() {
  const member = await requireMember();
  const allowedIds = new Set(channelsForTier(member.tier).map((c) => c.id));

  const channels = COMMUNITY_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    adminPostOnly: Boolean(c.adminPostOnly),
    allowed: allowedIds.has(c.id),
    lockLabel:
      c.gate === "vip_plus" ? "Pro & VIP" : c.gate === "pro" ? "Pro" : undefined,
  }));

  const settings = await getSummitSettings();
  const [speakers, agenda] = await Promise.all([
    listSpeakers(),
    listAgendaItems(settings.eventYear),
  ]);
  const { current, next } = currentAndNext(agenda);
  const highlight = current ?? next;

  return (
    <div className="tsls-community">
      <CommunityView
        channels={channels}
        memberName={member.name}
        memberInitials={member.initials}
        isAdmin={member.isAdmin}
        adminTitle={member.adminTitle}
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
