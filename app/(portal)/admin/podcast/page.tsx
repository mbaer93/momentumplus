import { PodcastManager } from "@/components/admin/PodcastManager";
import {
  listEpisodes,
  listPodcastQuestions,
  readPodcastSettings,
} from "@/lib/podcast";
import { isYoutubeApiReady } from "@/lib/service-config";

export const dynamic = "force-dynamic";

/* Admin → Branching Out: the sync channel, a sync-now button, the manual
   add-past-episode form, the episode list (hide/delete), and the on-air
   submissions review list. */
export default async function AdminPodcastPage() {
  const [settings, episodes, youtubeApiReady, questions] = await Promise.all([
    readPodcastSettings(),
    listEpisodes({ includeHidden: true }),
    isYoutubeApiReady(),
    listPodcastQuestions(),
  ]);

  return (
    <PodcastManager
      channelId={settings.channelId}
      spotifyUrl={settings.spotifyUrl}
      youtubeApiReady={youtubeApiReady}
      questions={questions}
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
