"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setLessonComplete } from "@/app/(portal)/education/actions";
import type { CourseLesson } from "@/lib/education";

/*
 * Interactive lesson list: watch links into the library plus per-lesson
 * completion toggles (lesson_progress rows; local state in preview mode).
 */
export function LessonList({ lessons }: { lessons: CourseLesson[] }) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(
    () => new Set(lessons.filter((l) => l.completed).map((l) => l.id)),
  );
  const [pending, startTransition] = useTransition();

  const pct =
    lessons.length > 0 ? Math.round((done.size / lessons.length) * 100) : 0;

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
        // Roll back the optimistic flip.
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
            fontSize: 12,
            color: "var(--mid-gray)",
            marginBottom: 6,
          }}
        >
          <span>
            {done.size} of {lessons.length} lessons completed
          </span>
          <span>{pct}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {lessons.map((lesson, i) => {
        const isDone = done.has(lesson.id);
        return (
          <div className="lesson-row" key={lesson.id}>
            <div className={`lesson-num${isDone ? " done" : ""}`}>
              {isDone ? "✓" : i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <div className="lesson-title">{lesson.title}</div>
              {lesson.summary && (
                <div className="lesson-summary">{lesson.summary}</div>
              )}
              <div className="lesson-actions">
                {lesson.videoId && (
                  <Link href={`/library/${lesson.videoId}`} className="btn-mini">
                    Watch lesson
                  </Link>
                )}
                <button
                  type="button"
                  className="btn-mini"
                  disabled={pending}
                  onClick={() => toggle(lesson)}
                  style={
                    isDone
                      ? { color: "var(--accent-green)", borderColor: "var(--accent-green)" }
                      : undefined
                  }
                >
                  {isDone ? "Completed" : "Mark complete"}
                </button>
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
