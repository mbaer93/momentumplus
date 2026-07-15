"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addLesson,
  createCourse,
  deleteCourse,
  moveLesson,
  removeLesson,
  removeLessonDocument,
  removeLessonImage,
  saveLessonQuiz,
  updateCourse,
  updateLessonDetails,
  uploadLessonDocument,
  uploadLessonImage,
  type CourseInput,
  type QuizQuestionInput,
} from "@/app/(portal)/admin/education/actions";
import { useRef } from "react";

export interface AdminLessonRow {
  id: string;
  title: string;
  summary: string;
  videoId: string | null;
  content: string;
  imageUrl: string | null;
  documents: { name: string; url: string }[];
  /** Full quiz including answers — admin-only view. */
  quiz: QuizQuestionInput[];
}

export interface AdminCourseRow {
  id: string;
  title: string;
  category: string;
  description: string;
  minAccess: "all_members" | "vip_plus" | "pro_only";
  published: boolean;
  ceHours: number | null;
  lessons: AdminLessonRow[];
}

export interface VideoOption {
  id: string;
  title: string;
}

const EMPTY: CourseInput = {
  title: "",
  category: "Leadership",
  description: "",
  minAccess: "all_members",
  published: false,
  ceHours: null,
};

function CourseFields({
  value,
  onChange,
  idPrefix,
}: {
  value: CourseInput;
  onChange: (v: CourseInput) => void;
  idPrefix: string;
}) {
  return (
    <>
      <div className="admin-field-row" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-title`}>Course title</label>
          <input
            id={`${idPrefix}-title`}
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            placeholder="e.g. The Resilient Leader Track"
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-cat`}>Category</label>
          <input
            id={`${idPrefix}-cat`}
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-access`}>Who can take it</label>
          <select
            id={`${idPrefix}-access`}
            value={value.minAccess}
            onChange={(e) =>
              onChange({
                ...value,
                minAccess:
                  e.target.value === "vip_plus" || e.target.value === "pro_only"
                    ? e.target.value
                    : "all_members",
              })
            }
          >
            <option value="all_members">All members</option>
            <option value="vip_plus">VIP &amp; annual only</option>
            <option value="pro_only">Pro members only (exclusive)</option>
          </select>
        </div>
      </div>
      <div className="admin-field" style={{ maxWidth: 340 }}>
        <label htmlFor={`${idPrefix}-ce`}>
          Duration in hours — whole numbers or decimals (CE hours on the
          certificate)
        </label>
        <input
          id={`${idPrefix}-ce`}
          type="number"
          min={0}
          step="any"
          value={value.ceHours ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              ceHours: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          placeholder="e.g. 2 or 1.5"
        />
      </div>
      <div className="admin-field">
        <label htmlFor={`${idPrefix}-desc`}>Description</label>
        <textarea
          id={`${idPrefix}-desc`}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </div>
      <label className="admin-check-row">
        <input
          type="checkbox"
          className="pref-toggle"
          checked={value.published}
          onChange={(e) => onChange({ ...value, published: e.target.checked })}
        />
        Published (visible on the Education page)
      </label>
    </>
  );
}

/* eslint-disable @next/next/no-img-element */
/** Full lesson editor: reading content, image, documents, and the optional test. */
function LessonEditor({ lesson }: { lesson: AdminLessonRow }) {
  const router = useRouter();
  const imageRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null);
  const [details, setDetails] = useState({
    title: lesson.title,
    summary: lesson.summary,
    content: lesson.content,
  });
  const [questions, setQuestions] = useState<QuizQuestionInput[]>(lesson.quiz);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — please try again.", ok: false });
      }
    });
  }

  function setQuestion(i: number, patch: Partial<QuizQuestionInput>) {
    setQuestions((prev) => prev.map((q, qi) => (qi === i ? { ...q, ...patch } : q)));
  }

  return (
    <div
      style={{
        margin: "8px 0 14px 28px",
        padding: "12px 14px",
        border: "1px solid var(--warm-gray)",
        borderRadius: 4,
        background: "var(--white)",
      }}
    >
      {/* Details */}
      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor={`ld-title-${lesson.id}`}>Lesson title</label>
          <input
            id={`ld-title-${lesson.id}`}
            value={details.title}
            onChange={(e) => setDetails({ ...details, title: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`ld-sum-${lesson.id}`}>One-line summary</label>
          <input
            id={`ld-sum-${lesson.id}`}
            value={details.summary}
            onChange={(e) => setDetails({ ...details, summary: e.target.value })}
          />
        </div>
      </div>
      <div className="admin-field">
        <label htmlFor={`ld-content-${lesson.id}`}>
          Reading / information (shown on the lesson page; blank line = new paragraph)
        </label>
        <textarea
          id={`ld-content-${lesson.id}`}
          rows={5}
          value={details.content}
          onChange={(e) => setDetails({ ...details, content: e.target.value })}
        />
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !details.title.trim()}
          onClick={() => run(() => updateLessonDetails(lesson.id, details))}
        >
          Save lesson
        </button>
      </div>

      {/* Image */}
      <div className="admin-form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
          Lesson image (PNG/JPG/WebP/GIF, &lt;4 MB):
        </span>
        {lesson.imageUrl && (
          <img
            src={lesson.imageUrl}
            alt="Lesson"
            style={{ maxHeight: 44, borderRadius: 4, border: "1px solid var(--warm-gray)" }}
          />
        )}
        <input type="file" accept="image/*" ref={imageRef} style={{ fontSize: 12 }} />
        <button
          type="button"
          className="btn-mini"
          disabled={pending}
          onClick={() => {
            const file = imageRef.current?.files?.[0];
            if (!file) {
              setMsg({ text: "Choose an image file first.", ok: false });
              return;
            }
            const fd = new FormData();
            fd.append("file", file);
            run(() => uploadLessonImage(lesson.id, fd));
          }}
        >
          Upload image
        </button>
        {lesson.imageUrl && (
          <button
            type="button"
            className="btn-mini danger"
            disabled={pending}
            onClick={() => run(() => removeLessonImage(lesson.id))}
          >
            Remove image
          </button>
        )}
      </div>

      {/* Documents */}
      <div style={{ marginTop: 12 }}>
        <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
          Documents &amp; resources (PDFs, worksheets — &lt;20 MB each):
        </span>
        {lesson.documents.map((d) => (
          <div
            key={d.url}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}
          >
            <span style={{ fontSize: 12.5, flex: 1 }}>{d.name}</span>
            <button
              type="button"
              className="btn-mini danger"
              disabled={pending}
              onClick={() => run(() => removeLessonDocument(lesson.id, d.url))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="admin-form-actions" style={{ marginTop: 6 }}>
          <input type="file" ref={docRef} style={{ fontSize: 12 }} />
          <button
            type="button"
            className="btn-mini"
            disabled={pending}
            onClick={() => {
              const file = docRef.current?.files?.[0];
              if (!file) {
                setMsg({ text: "Choose a document first.", ok: false });
                return;
              }
              const fd = new FormData();
              fd.append("file", file);
              run(() => uploadLessonDocument(lesson.id, fd));
            }}
          >
            Attach document
          </button>
        </div>
      </div>

      {/* Test */}
      <div style={{ marginTop: 14 }}>
        <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
          Optional test — with questions saved, members must pass (70%) to
          complete this lesson. With no test, opening the lesson completes it
          automatically.
        </span>
        {questions.map((q, qi) => (
          <div
            key={qi}
            style={{
              border: "1px solid var(--warm-gray)",
              borderRadius: 4,
              padding: 10,
              marginTop: 8,
            }}
          >
            <div className="admin-field" style={{ marginBottom: 8 }}>
              <label htmlFor={`q-${lesson.id}-${qi}`}>Question {qi + 1}</label>
              <input
                id={`q-${lesson.id}-${qi}`}
                value={q.q}
                onChange={(e) => setQuestion(qi, { q: e.target.value })}
                placeholder="What is…?"
              />
            </div>
            <div className="admin-field" style={{ marginBottom: 8 }}>
              <label htmlFor={`opts-${lesson.id}-${qi}`}>
                Answer options (one per line)
              </label>
              <textarea
                id={`opts-${lesson.id}-${qi}`}
                rows={3}
                value={q.options.join("\n")}
                onChange={(e) =>
                  setQuestion(qi, { options: e.target.value.split("\n") })
                }
              />
            </div>
            <div className="admin-form-actions" style={{ marginTop: 0 }}>
              <label style={{ fontSize: 12.5 }}>
                Correct answer{" "}
                <select
                  value={q.answer}
                  onChange={(e) => setQuestion(qi, { answer: Number(e.target.value) })}
                >
                  {q.options.map((opt, oi) => (
                    <option key={oi} value={oi}>
                      {oi + 1}. {opt.slice(0, 40) || "(empty)"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-mini danger"
                onClick={() =>
                  setQuestions((prev) => prev.filter((_, i) => i !== qi))
                }
              >
                Remove question
              </button>
            </div>
          </div>
        ))}
        <div className="admin-form-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn-mini"
            onClick={() =>
              setQuestions((prev) => [
                ...prev,
                { q: "", options: ["", ""], answer: 0 },
              ])
            }
          >
            Add question
          </button>
          <button
            type="button"
            className="btn-purple"
            disabled={pending}
            onClick={() => run(() => saveLessonQuiz(lesson.id, questions))}
          >
            Save test
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginTop: 8 }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

export function CoursesManager({
  courses,
  videos,
  initialEditId,
}: {
  courses: AdminCourseRow[];
  videos: VideoOption[];
  initialEditId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CourseInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(initialEditId ?? null);
  const seed = courses.find((c) => c.id === editingId);
  const [editForm, setEditForm] = useState<CourseInput>(
    seed
      ? {
          title: seed.title,
          category: seed.category,
          description: seed.description,
          minAccess: seed.minAccess,
          published: seed.published,
          ceHours: seed.ceHours,
        }
      : EMPTY,
  );
  const [newLesson, setNewLesson] = useState({ videoId: "", title: "", summary: "" });
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — please try again.", ok: false });
      }
    });
  }

  function beginEdit(c: AdminCourseRow) {
    setEditingId(c.id);
    setEditForm({
      title: c.title,
      category: c.category,
      description: c.description,
      minAccess: c.minAccess,
      published: c.published,
      ceHours: c.ceHours,
    });
    setNewLesson({ videoId: "", title: "", summary: "" });
  }

  return (
    <div>
      {/* Create */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 13 }}>Add a course</label>
        </div>
        <CourseFields value={form} onChange={setForm} idPrefix="new" />
        <div className="admin-form-actions">
          <button
            type="button"
            className="btn-purple"
            disabled={pending || !form.title.trim()}
            onClick={() =>
              run(async () => {
                const res = await createCourse(form);
                if (res.ok) setForm(EMPTY);
                return res;
              })
            }
          >
            Add course
          </button>
          {msg && (
            <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Lessons</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "var(--mid-gray)" }}>
                  No courses yet — add the first one above, then attach lessons.
                </td>
              </tr>
            )}
            {courses.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td>
                    <div className="admin-row-title">{c.title}</div>
                    <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                      {c.category}
                      {c.minAccess === "vip_plus" ? " · VIP & annual" : ""}
                      {c.minAccess === "pro_only" ? " · Pro only" : ""}
                    </div>
                  </td>
                  <td>{c.lessons.length}</td>
                  <td>
                    <span className="admin-status draft">
                      {c.published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td>
                    <div
                      className="admin-actions-cell"
                      style={{ justifyContent: "flex-end" }}
                    >
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() =>
                          editingId === c.id ? setEditingId(null) : beginEdit(c)
                        }
                      >
                        {editingId === c.id ? "Close" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className="btn-mini danger"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Delete "${c.title}" and its lessons?`)) {
                            run(() => deleteCourse(c.id));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === c.id && (
                  <tr>
                    <td colSpan={4} style={{ background: "#fbfaf8" }}>
                      <div style={{ padding: "6px 4px" }}>
                        <CourseFields
                          value={editForm}
                          onChange={setEditForm}
                          idPrefix={`edit-${c.id}`}
                        />
                        <div className="admin-form-actions" style={{ marginTop: 4 }}>
                          <button
                            type="button"
                            className="btn-purple"
                            disabled={pending || !editForm.title.trim()}
                            onClick={() => run(() => updateCourse(c.id, editForm))}
                          >
                            Save course
                          </button>
                        </div>

                        {/* Lessons */}
                        <div
                          className="admin-field"
                          style={{ marginTop: 16, marginBottom: 4 }}
                        >
                          <label style={{ fontSize: 13 }}>
                            Lessons (in order)
                          </label>
                        </div>
                        {c.lessons.length === 0 && (
                          <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                            No lessons yet — add one below from the library.
                          </div>
                        )}
                        {c.lessons.map((l, i) => (
                          <Fragment key={l.id}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "7px 0",
                              borderBottom: "1px solid var(--warm-gray)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--mid-gray)",
                                width: 18,
                              }}
                            >
                              {i + 1}.
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                                {l.title}
                              </div>
                              {l.summary && (
                                <div
                                  style={{ fontSize: 12, color: "var(--mid-gray)" }}
                                >
                                  {l.summary}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={pending || i === 0}
                              onClick={() => run(() => moveLesson(l.id, "up"))}
                              aria-label="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={pending || i === c.lessons.length - 1}
                              onClick={() => run(() => moveLesson(l.id, "down"))}
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={() =>
                                setEditingLessonId(
                                  editingLessonId === l.id ? null : l.id,
                                )
                              }
                            >
                              {editingLessonId === l.id ? "Close" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className="btn-mini danger"
                              disabled={pending}
                              onClick={() => run(() => removeLesson(l.id))}
                            >
                              Remove
                            </button>
                          </div>
                          {editingLessonId === l.id && <LessonEditor lesson={l} />}
                          </Fragment>
                        ))}

                        {/* Add lesson */}
                        <div
                          className="admin-field-row"
                          style={{
                            gridTemplateColumns: "1.4fr 1.2fr 1.4fr auto",
                            alignItems: "end",
                            marginTop: 12,
                          }}
                        >
                          <div className="admin-field">
                            <label htmlFor={`lesson-video-${c.id}`}>
                              Library recording
                            </label>
                            <select
                              id={`lesson-video-${c.id}`}
                              value={newLesson.videoId}
                              onChange={(e) => {
                                const v = videos.find(
                                  (x) => x.id === e.target.value,
                                );
                                setNewLesson((prev) => ({
                                  ...prev,
                                  videoId: e.target.value,
                                  title: prev.title || v?.title || "",
                                }));
                              }}
                            >
                              <option value="">No video (reading/exercise)</option>
                              {videos.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="admin-field">
                            <label htmlFor={`lesson-title-${c.id}`}>
                              Lesson title
                            </label>
                            <input
                              id={`lesson-title-${c.id}`}
                              value={newLesson.title}
                              onChange={(e) =>
                                setNewLesson({ ...newLesson, title: e.target.value })
                              }
                            />
                          </div>
                          <div className="admin-field">
                            <label htmlFor={`lesson-summary-${c.id}`}>
                              One-line summary (optional)
                            </label>
                            <input
                              id={`lesson-summary-${c.id}`}
                              value={newLesson.summary}
                              onChange={(e) =>
                                setNewLesson({
                                  ...newLesson,
                                  summary: e.target.value,
                                })
                              }
                            />
                          </div>
                          <button
                            type="button"
                            className="btn-mini"
                            style={{ marginBottom: 14 }}
                            disabled={pending || !newLesson.title.trim()}
                            onClick={() =>
                              run(async () => {
                                const res = await addLesson(c.id, newLesson);
                                if (res.ok) {
                                  setNewLesson({ videoId: "", title: "", summary: "" });
                                }
                                return res;
                              })
                            }
                          >
                            Add lesson
                          </button>
                        </div>
                        {msg && (
                          <div
                            className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
                            style={{ marginTop: 6 }}
                          >
                            {msg.text}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
