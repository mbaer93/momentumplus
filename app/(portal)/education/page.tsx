import Link from "next/link";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { requireMember } from "@/lib/current-member";
import { courseUnlocked, listCourses } from "@/lib/education";

export const dynamic = "force-dynamic";

export default async function EducationPage() {
  const member = await requireMember();
  const courses = await listCourses();
  // Members only see published courses; admins also see drafts (marked).
  const visible = courses.filter((c) => c.published || member.isAdmin);

  return (
    <div className="sessions-pad">
      <div className="section-header">
        <div>
          <h2>Education</h2>
          <p>Structured learning tracks built from the session library</p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/education" label="Manage courses" />
        )}
      </div>

      <BodyAd variant="banner" />

      {visible.length === 0 && (
        <div className="sessions-empty" style={{ marginTop: 20 }}>
          Learning tracks will appear here as they&apos;re published.
        </div>
      )}

      <div className="course-grid">
        {visible.map((c) => {
          const unlocked = courseUnlocked(c, member.tier);
          const lessonCount = c.lessonCount ?? c.lessons.length;
          const pct =
            c.lessons.length > 0
              ? Math.round((c.completedCount / c.lessons.length) * 100)
              : 0;
          const body = (
            <>
              <div className="course-cat">
                {c.category}
                {!c.published && (
                  <span className="admin-status draft">Draft</span>
                )}
                {c.minAccess === "vip_plus" && (
                  <span className="recording-vip" style={{ position: "static" }}>
                    EXCLUSIVE
                  </span>
                )}
                {c.minAccess === "pro_only" && (
                  <span className="recording-vip" style={{ position: "static" }}>
                    PRO
                  </span>
                )}
              </div>
              <div className="course-title">{c.title}</div>
              <div className="course-desc">{c.description}</div>
              <div className="course-meta">
                {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
                {unlocked && c.completedCount > 0
                  ? ` · ${c.completedCount} completed`
                  : ""}
                {!unlocked
                  ? c.minAccess === "pro_only"
                    ? " · Momentum+ Pro exclusive"
                    : " · Available to VIP and annual members"
                  : ""}
              </div>
              {unlocked && (
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
              )}
            </>
          );
          return (
            <Link
              key={c.id}
              href={`/education/${c.id}`}
              className="course-card"
              style={unlocked ? undefined : { opacity: 0.75 }}
            >
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
