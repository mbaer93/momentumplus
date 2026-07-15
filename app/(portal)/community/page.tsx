import { CommunityView } from "@/components/community/CommunityView";
import { requireMember } from "@/lib/current-member";
import { listSessions } from "@/lib/sessions/queries";
import { COMMUNITY_CHANNELS, channelsForTier, isStreamConfigured } from "@/lib/stream";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { dayOfMonth, monthShort, timeLabel } from "@/lib/sessions/view";

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const member = await requireMember();
  const allowedIds = new Set(channelsForTier(member.tier).map((c) => c.id));

  // Show every channel; tier-locked ones render with a lock (the real gate is
  // server-side in /api/stream/token — the UI lock is cosmetic).
  const channels = COMMUNITY_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    adminPostOnly: Boolean(c.adminPostOnly),
    allowed: allowedIds.has(c.id),
    lockLabel: c.gate === "vip_plus" ? "VIP" : c.gate === "annual" ? "Annual" : undefined,
  }));

  // Next upcoming session for the sidebar card.
  const sessions = await listSessions();
  const next = sessions
    .filter((s) => new Date(s.startsAt).getTime() > Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];

  return (
    <CommunityView
      channels={channels}
      memberName={member.name}
      memberInitials={member.initials}
      isAdmin={member.isAdmin}
      streamConfigured={isStreamConfigured()}
      preview={!isSupabaseConfigured()}
      nextSession={
        next
          ? {
              dateLabel: `${monthShort(next.startsAt)} ${dayOfMonth(next.startsAt)}`,
              title: next.title,
              meta: `${next.speaker.name} · ${timeLabel(next.startsAt)}`,
            }
          : {
              dateLabel: "SOON",
              title: "New sessions coming",
              meta: "Watch this space",
            }
      }
    />
  );
}
