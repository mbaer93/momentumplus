import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonAutoComplete } from "@/components/education/LessonAutoComplete";
import { LessonQuiz } from "@/components/education/LessonQuiz";
import { VideoPlayer } from "@/components/library/VideoPlayer";
import { ArrowLeftIcon, DocIcon, ExternalIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import { courseUnlocked, getCourse } from "@/lib/education";
import { generateMuxPlaybackToken, isMuxSigningConfigured } from "@/lib/mux";
import { getVideo } from "@/lib/videos/queries";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: { id: string; lessonId: string };
}) {
  const member = await requireMember();
  const course = await getCourse(params.id);
  if (!course || (!course.published && !member.isAdmin)) notFound();
  if (!courseUnlocked(course, member.tier)) notFound();

  const index = course.lessons.findIndex((l) => l.id === params.lessonId);
  const lesson = course.lessons[index];
  if (!lesson) notFound();
  const next = course.lessons[index + 1] ?? null;

  const video = lesson.videoId
    ? await getVideo(lesson.videoId, member.tier)
    : null;
  const playbackToken =
    video?.muxPlaybackId && isMuxSigningConfigured()
      ? generateMuxPlaybackToken(video.muxPlaybackId)
      : null;

  const paragraphs = lesson.content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="sess-detail-wrap" style={{ maxWidth: 860 }}>
      {/* No test → opening the lesson completes it. */}
      {!lesson.quiz && !lesson.completed && (
        <LessonAutoComplete lessonId={lesson.id} />
      )}

      <Link href={`/education/${course.id}`} className="sess-back">
        <ArrowLeftIcon size={12} /> {course.title}
      </Link>

      <div className="section-header">
        <div>
          <div className="course-cat" style={{ marginBottom: 6 }}>
            Lesson {index + 1} of {course.lessons.length}
            {lesson.completed && (
              <span className="admin-status completed">Completed</span>
            )}
            {lesson.quiz && !lesson.completed && (
              <span className="admin-status draft">Test required</span>
            )}
          </div>
          <h2>{lesson.title}</h2>
          {lesson.summary && <p>{lesson.summary}</p>}
        </div>
      </div>

      {video && (
        <VideoPlayer
          videoId={video.id}
          playbackId={video.muxPlaybackId}
          playbackToken={playbackToken}
          title={video.title}
        />
      )}

      {lesson.imageUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={lesson.imageUrl}
          alt={lesson.title}
          style={{
            width: "100%",
            borderRadius: 8,
            border: "1px solid var(--warm-gray)",
            marginTop: video ? 16 : 0,
          }}
        />
      )}

      {paragraphs.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ padding: "18px 22px" }}>
            {paragraphs.map((p, i) => (
              <p className="sess-desc" key={i} style={{ marginBottom: 12 }}>
                {p}
              </p>
            ))}
          </div>
        </div>
      )}

      {lesson.documents.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h3>Documents &amp; resources</h3>
          </div>
          <div style={{ padding: "10px 22px 18px" }}>
            {lesson.documents.map((d) => (
              <a
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="sp-link"
                style={{ display: "flex", gap: 8, padding: "8px 0" }}
              >
                <DocIcon size={16} /> {d.name} <ExternalIcon size={11} />
              </a>
            ))}
          </div>
        </div>
      )}

      {lesson.quiz && (
        <LessonQuiz
          lessonId={lesson.id}
          questions={lesson.quiz}
          completed={lesson.completed}
        />
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 22,
          gap: 12,
        }}
      >
        <Link href={`/education/${course.id}`} className="btn-mini">
          Back to course
        </Link>
        {next ? (
          <Link href={`/education/${course.id}/${next.id}`} className="btn-primary">
            Next lesson: {next.title}
          </Link>
        ) : (
          <Link href={`/education/${course.id}`} className="btn-primary">
            Finish course
          </Link>
        )}
      </div>
    </div>
  );
}
