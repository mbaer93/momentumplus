import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { requireMember } from "@/lib/current-member";
import { requireFeature } from "@/lib/entitlements";
import { listTopics } from "@/lib/topics";
import { listVideos } from "@/lib/videos/queries";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const member = await requireMember();
  await requireFeature("library");
  const [videos, topics] = await Promise.all([
    listVideos(member.tier),
    listTopics(),
  ]);

  return (
    <div className="library-pad">
      <BodyAd variant="banner" />
      <LibraryBrowser videos={videos} topics={topics} isAdmin={member.isAdmin} />
    </div>
  );
}
