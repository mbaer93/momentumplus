import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminEditChip } from "@/components/admin/AdminChips";
import { LessonList } from "@/components/education/LessonList";
import { ArrowLeftIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import { courseUnlocked, getCourse } from "@/lib/education";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
}: {
  params: { id: string };
}) {
  const member = await requireMember();
  const course = await getCourse(params.id);
  if (!course || (!course.published && !member.isAdmin)) notFound();

  const unlocked = courseUnlocked(course, member.tier);

  return (
    <div className="sessions-pad" style={{ maxWidth: 860 }}>
      <Link href="/education" className="sess-back">
        <ArrowLeftIcon size={12} /> Education
      </Link>
      <div className="section-header">
        <div>
          <div className="course-cat" style={{ marginBottom: 6 }}>
            {course.category}
            {!course.published && <span className="admin-status draft">Draft</span>}
          </div>
          <h2>{course.title}</h2>
          <p>{course.description}</p>
        </div>
        {member.isAdmin && (
          <AdminEditChip href={`/admin/education?edit=${course.id}`} />
        )}
      </div>

      {unlocked ? (
        <LessonList lessons={course.lessons} />
      ) : (
        <div className="admin-banner" style={{ marginTop: 8 }}>
          <div>
            <h3>This track is for VIP &amp; annual members</h3>
            <p>Upgrade your membership to unlock every lesson in this course.</p>
          </div>
          <div className="admin-banner-actions">
            <Link href="/profile" className="btn-sm-gold">
              View membership options
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
