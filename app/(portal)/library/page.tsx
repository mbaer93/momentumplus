import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { requireMember } from "@/lib/current-member";
import { listVideos } from "@/lib/videos/queries";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const member = await requireMember();
  const videos = await listVideos(member.tier);

  return (
    <div className="library-pad">
      <LibraryBrowser videos={videos} />
    </div>
  );
}
