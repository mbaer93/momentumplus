import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/education/PrintButton";
import { ArrowLeftIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import { courseUnlocked, effectiveCeHours, getCourse } from "@/lib/education";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Printable completion certificate. Available once every lesson in the
 * course is complete; shows the admin-set continuing-education hours.
 */
export default async function CertificatePage({
  params,
}: {
  params: { id: string };
}) {
  const member = await requireMember();
  const course = await getCourse(params.id);
  if (!course || (!course.published && !member.isAdmin)) notFound();
  if (!courseUnlocked(course, member.tier)) notFound();

  const complete =
    course.lessons.length > 0 && course.lessons.every((l) => l.completed);
  if (!complete) redirect(`/education/${course.id}`);

  // Completion date = when the last lesson was finished.
  let completedOn = new Date();
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Own rows only — the read policy also shows admins OTHER members'
    // progress, which must never set this member's completion date.
    const { data } = user
      ? await supabase
          .from("lesson_progress")
          .select("completed_at")
          .eq("profile_id", user.id)
          .in(
            "lesson_id",
            course.lessons.map((l) => l.id),
          )
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    if (data?.completed_at) completedOn = new Date(data.completed_at);
  }

  const dateLabel = completedOn.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="sess-detail-wrap" style={{ maxWidth: 900 }}>
      <div className="no-print" style={{ marginBottom: 14 }}>
        <Link href={`/education/${course.id}`} className="sess-back">
          <ArrowLeftIcon size={12} /> {course.title}
        </Link>
      </div>

      <div className="certificate">
        <div className="certificate-inner">
          <div className="certificate-brand">
            Momentum<span style={{ color: "var(--gold)" }}>+</span>
          </div>
          <div className="certificate-sub">
            The Tri-State Leadership Summit · Sierra Learnership Collaborative
          </div>
          <div className="certificate-label">Certificate of Completion</div>
          <div className="certificate-name">{member.name}</div>
          <div className="certificate-body">
            has successfully completed the course
          </div>
          <div className="certificate-course">{course.title}</div>
          {(() => {
            // No test on any lesson → capped at 0.5 CE hours (full credit
            // requires passing a test at 75%+).
            const hours = effectiveCeHours(course);
            return hours !== null && hours > 0 ? (
              <div className="certificate-hours">
                {hours} educational hour
                {hours === 1 ? "" : "s"}
              </div>
            ) : null;
          })()}
          <div className="certificate-date">Completed {dateLabel}</div>
          <div className="certificate-footer">
            <div className="certificate-line">
              <div className="certificate-signature">Sierra Collins</div>
              <div className="certificate-rule" />
              <div>Momentum+ Education</div>
            </div>
            <div className="certificate-line">
              <div className="certificate-seal">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/slc-seal.png"
                  alt="Sierra Learnership Collaborative seal"
                  width={78}
                  height={78}
                />
              </div>
              <div className="certificate-rule" />
              <div>Sierra Learnership Collaborative</div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="no-print"
        style={{ display: "flex", justifyContent: "center", marginTop: 18 }}
      >
        <PrintButton />
      </div>
    </div>
  );
}
