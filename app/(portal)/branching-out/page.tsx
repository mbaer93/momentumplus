import { AdminAddChip } from "@/components/admin/AdminChips";
import { EpisodeBrowser } from "@/components/podcast/EpisodeBrowser";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { requireMember } from "@/lib/current-member";
import { requireFeature } from "@/lib/entitlements";
import { listEpisodes, readPodcastSettings } from "@/lib/podcast";

export const dynamic = "force-dynamic";

/* The Branching Out podcast (Matt, 2026-08-05). Episodes auto-sync from the
   show's YouTube channel; admins import/curate in Admin -> Branching Out.
   Seasons + the follow/share block live in EpisodeBrowser. */
export default async function BranchingOutPage() {
  const member = await requireMember();
  await requireFeature("branching_out");
  const [episodes, settings] = await Promise.all([
    listEpisodes(),
    readPodcastSettings(),
  ]);

  return (
    <div className="sessions-pad">
      <div className="section-header">
        <div>
          <h2>Branching Out</h2>
          <p>The Branching Out podcast — new episodes every week</p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/podcast" label="Manage episodes" />
        )}
      </div>
      <BodyAd variant="banner" />

      {episodes.length === 0 ? (
        <div className="sessions-empty">
          Episodes are on the way — check back soon.
        </div>
      ) : (
        <EpisodeBrowser
          episodes={episodes}
          channelId={settings.channelId}
          spotifyUrl={settings.spotifyUrl}
        />
      )}
    </div>
  );
}
