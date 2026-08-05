import { AdminAddChip } from "@/components/admin/AdminChips";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { requireMember } from "@/lib/current-member";
import { requireFeature } from "@/lib/entitlements";
import { listEpisodes } from "@/lib/podcast";

export const dynamic = "force-dynamic";

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/* The Branching Out podcast (Matt, 2026-08-05). Episodes auto-sync from the
   show's YouTube channel; admins can add past episodes manually. */
export default async function BranchingOutPage() {
  const member = await requireMember();
  await requireFeature("branching_out");
  const episodes = await listEpisodes();

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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 20,
          }}
        >
          {episodes.map((ep) => {
            const demo = ep.youtubeVideoId.startsWith("demo-");
            return (
              <div key={ep.id} className="card" style={{ overflow: "hidden" }}>
                <div
                  style={{
                    position: "relative",
                    aspectRatio: "16 / 9",
                    background: "var(--navy)",
                  }}
                >
                  {demo ? (
                    // Preview mode: a styled stand-in instead of a dead embed.
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--gold)",
                        fontFamily: "'Playfair Display', serif",
                        fontSize: 22,
                      }}
                    >
                      Branching Out
                    </div>
                  ) : (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${ep.youtubeVideoId}`}
                      title={ep.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        border: 0,
                      }}
                    />
                  )}
                </div>
                <div style={{ padding: "14px 16px 16px" }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--mid-gray)",
                      marginBottom: 4,
                    }}
                  >
                    {dateLabel(ep.publishedAt)}
                  </div>
                  <h3
                    style={{
                      fontFamily: "'Playfair Display', serif",
                      fontSize: 16.5,
                      lineHeight: 1.35,
                      margin: 0,
                    }}
                  >
                    {ep.title}
                  </h3>
                  {ep.showNotes && (
                    <details style={{ marginTop: 8 }}>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--gold)",
                          listStyle: "none",
                        }}
                      >
                        Show notes
                      </summary>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: "var(--mid-gray)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {ep.showNotes}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
