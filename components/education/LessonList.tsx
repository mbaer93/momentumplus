"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setLessonComplete } from "@/app/(portal)/education/actions";
import type { CourseLesson } from "@/lib/education";

/*
 * Course lesson list: each lesson opens its own page (video, image,
 * reading, documents, optional test). Lessons without a test can also be
 * toggled complete here; test lessons complete only by passing. When every
 * lesson is done, the printable certificate unlocks.
 */
export function LessonList({
  courseId,
  lessons,
  ceHours,
}: {
  courseId: string;
  lessons: CourseLesson[];
  ceHours: number | null;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(
    () => new Set(lessons.filter((l) => l.completed).map((l) => l.id)),
  );
  const [pending, startTransition] = useTransition();

  const pct =
    lessons.length > 0 ? Math.round((done.size / lessons.length) * 100) : 0;
  const allDone = lessons.length > 0 && done.size === lessons.length;

  function toggle(lesson: CourseLesson) {
    const completed = !done.has(lesson.id);
    setDone((prev) => {
      const next = new Set(prev);
      if (completed) next.add(lesson.id);
      else next.delete(lesson.id);
      return next;
    });
    startTransition(async () => {
      const res = await setLessonComplete(lesson.id, completed);
      if (!res.ok) {
        setDone((prev) => {
          const next = new Set(prev);
          if (completed) next.delete(lesson.id);
          else next.add(lesson.id);
          return next;
        });
      } else if (!res.preview) {
        router.refresh();
      }
    });
  }

  return (
    <div className="card" style={{ padding: "6px 22px" }}>
      <div style={{ padding: "16px 0 4px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "var(--mid-gray)",
            marginBottom: 6,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>
            {done.size} of {lessons.length} lessons completed
            {ceHours ? ` · ${ceHours} educational hour${ceHours === 1 ? "" : "s"} on your certificate` : ""}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        {allDone && (
          <div style={{ marginTop: 12 }}>
            <Link href={`/education/${courseId}/certificate`} className="btn-sm-gold">
              Course complete — view your certificate
            </Link>
          </div>
        )}
      </div>
      {lessons.map((lesson, i) => {
        const isDone = done.has(lesson.id);
        return (
          <div className="lesson-row" key={lesson.id}>
            <div className={`lesson-num${isDone ? " done" : ""}`}>
              {isDone ? "✓" : i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <Link
                href={`/education/${courseId}/${lesson.id}`}
                className="lesson-title"
                style={{ display: "inline-block", color: "inherit" }}
              >
                {lesson.title}
              </Link>
              {lesson.quiz && (
                <span
                  className="admin-status draft"
                  style={{ marginLeft: 8, fontSize: 10 }}
                >
                  Test
                </span>
              )}
              {lesson.summary && (
                <div className="lesson-summary">{lesson.summary}</div>
              )}
              <div className="lesson-actions">
                <Link
                  href={`/education/${courseId}/${lesson.id}`}
                  className="btn-mini"
                >
                  Open lesson
                </Link>
                {!lesson.quiz && (
                  <button
                    type="button"
                    className="btn-mini"
                    disabled={pending}
                    onClick={() => toggle(lesson)}
                    style={
                      isDone
                        ? {
                            color: "var(--accent-green)",
                            borderColor: "var(--accent-green)",
                          }
                        : undefined
                    }
                  >
                    {isDone ? "Completed" : "Mark complete"}
                  </button>
                )}
                {lesson.quiz && isDone && (
                  <span
                    style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600 }}
                  >
                    Test passed
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {lessons.length === 0 && (
        <div style={{ padding: "14px 0 20px", color: "var(--mid-gray)", fontSize: 13 }}>
          Lessons are being added to this course.
        </div>
      )}
    </div>
  );
}
