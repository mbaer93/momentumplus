"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitLessonQuiz } from "@/app/(portal)/education/actions";
import type { QuizQuestionPublic } from "@/lib/education";

/** Lesson test: pick answers, graded server-side; passing completes the lesson. */
export function LessonQuiz({
  lessonId,
  questions,
  completed,
}: {
  lessonId: string;
  questions: QuizQuestionPublic[];
  completed: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<number[]>(
    () => new Array(questions.length).fill(-1),
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  function submit() {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await submitLessonQuiz(lessonId, answers);
        setResult({
          text: res.message ?? (res.passed ? "Passed." : "Not quite — try again."),
          ok: res.passed,
        });
        if (res.passed) router.refresh();
      } catch {
        setResult({ text: "Couldn't submit — try again.", ok: false });
      }
    });
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <h3>Knowledge check</h3>
      </div>
      <div style={{ padding: 18 }}>
        {completed && (
          <div className="admin-form-msg ok" style={{ marginBottom: 12 }}>
            You&apos;ve passed this test — the lesson is complete.
          </div>
        )}
        {questions.map((q, qi) => (
          <div key={qi} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {qi + 1}. {q.q}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {q.options.map((opt, oi) => (
                <label
                  key={oi}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 13.5,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name={`q-${qi}`}
                    checked={answers[qi] === oi}
                    onChange={() =>
                      setAnswers((prev) => {
                        const next = [...prev];
                        next[qi] = oi;
                        return next;
                      })
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn-primary"
          disabled={pending || answers.some((a) => a < 0)}
          onClick={submit}
        >
          {pending ? "Grading…" : "Submit answers"}
        </button>
        {result && (
          <div
            className={`admin-form-msg ${result.ok ? "ok" : "err"}`}
            style={{ marginTop: 10 }}
          >
            {result.text}
          </div>
        )}
      </div>
    </div>
  );
}
