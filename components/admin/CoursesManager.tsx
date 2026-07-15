"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addLesson,
  createCourse,
  deleteCourse,
  moveLesson,
  removeLesson,
  updateCourse,
  type CourseInput,
} from "@/app/(portal)/admin/education/actions";

export interface AdminLessonRow {
  id: string;
  title: string;
  summary: string;
  videoId: string | null;
}

export interface AdminCourseRow {
  id: string;
  title: string;
  category: string;
  description: string;
  minAccess: "all_members" | "vip_plus";
  published: boolean;
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
                minAccess: e.target.value === "vip_plus" ? "vip_plus" : "all_members",
              })
            }
          >
            <option value="all_members">All members</option>
            <option value="vip_plus">VIP &amp; annual only</option>
          </select>
        </div>
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
        }
      : EMPTY,
  );
  const [newLesson, setNewLesson] = useState({ videoId: "", title: "", summary: "" });
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
                          <div
                            key={l.id}
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
                              className="btn-mini danger"
                              disabled={pending}
                              onClick={() => run(() => removeLesson(l.id))}
                            >
                              Remove
                            </button>
                          </div>
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
