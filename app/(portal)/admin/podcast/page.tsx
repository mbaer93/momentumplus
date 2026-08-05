import { PodcastManager } from "@/components/admin/PodcastManager";
import { listEpisodes, readPodcastSettings } from "@/lib/podcast";
import { isYoutubeApiReady } from "@/lib/service-config";

export const dynamic = "force-dynamic";

/* Admin → Branching Out: the sync channel, a sync-now button, the manual
   add-past-episode form, and the episode list (hide/delete). */
export default async function AdminPodcastPage() {
  const [settings, episodes, youtubeApiReady] = await Promise.all([
    readPodcastSettings(),
    listEpisodes({ includeHidden: true }),
    isYoutubeApiReady(),
  ]);

  return (
    <PodcastManager
      channelId={settings.channelId}
      spotifyUrl={settings.spotifyUrl}
      youtubeApiReady={youtubeApiReady}
      episodes={episodes.map((e) => ({
        id: e.id,
        youtubeVideoId: e.youtubeVideoId,
        title: e.title,
        showNotes: e.showNotes,
        publishedAt: e.publishedAt,
        source: e.source,
        hidden: e.hidden,
        season: e.season,
      }))}
    />
  );
}
