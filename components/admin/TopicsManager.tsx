"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveTopic,
  createTopic,
  renameTopic,
  setTopics,
  type TopicResult,
} from "@/app/(portal)/admin/topics/actions";
import type { Topic } from "@/lib/topics";

export interface TaggableItem {
  id: string;
  title: string;
  speakerName: string;
  kind: "video" | "session";
  primaryId: string | null;
  secondaryIds: string[];
}

export function TopicsManager({
  topics,
  items,
}: {
  topics: Topic[];
  items: TaggableItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [newSort, setNewSort] = useState("100");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState("100");

  // One talk's assignment editor open at a time; edits stay local until Save.
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    primaryId: string | null;
    secondaryIds: string[];
  }>({ primaryId: null, secondaryIds: [] });
  const [search, setSearch] = useState("");

  const topicName = useMemo(
    () => new Map(topics.map((t) => [t.id, t.name])),
    [topics],
  );

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.speakerName.toLowerCase().includes(q),
    );
  }, [items, search]);

  function run(fn: () => Promise<TopicResult>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      if (res.ok) router.refresh();
    });
  }

  function openEditor(item: TaggableItem) {
    setOpenItem(item.id);
    setDraft({ primaryId: item.primaryId, secondaryIds: item.secondaryIds });
  }

  return (
    <>
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} role="status">
          {msg.text}
        </div>
      )}

      {/* ── The taxonomy ─────────────────────────────────────────────── */}
      <div className="section-header">
        <div>
          <h2>Categories</h2>
          <p>
            What members browse the Library by. Add one whenever a new speaker
            brings a subject that isn&apos;t covered — nothing needs a deploy.
          </p>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginBottom: 20 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: 90 }}>Sort</th>
              <th style={{ width: 90 }}>Used by</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => {
              const used = items.filter(
                (i) => i.primaryId === t.id || i.secondaryIds.includes(t.id),
              ).length;
              const editing = editId === t.id;
              return (
                <tr key={t.id}>
                  <td>
                    {editing ? (
                      <input
                        className="topic-inline-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label="Category name"
                      />
                    ) : (
                      <span className="admin-row-title">{t.name}</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input
                        className="topic-inline-input"
                        inputMode="numeric"
                        value={editSort}
                        onChange={(e) => setEditSort(e.target.value)}
                        aria-label="Sort order"
                      />
                    ) : (
                      t.sort
                    )}
                  </td>
                  <td>{used}</td>
                  <td>
                    <div className="admin-actions-cell">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="btn-mini"
                            disabled={pending}
                            onClick={() => {
                              run(() => renameTopic(t.id, editName, editSort));
                              setEditId(null);
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => {
                              setEditId(t.id);
                              setEditName(t.name);
                              setEditSort(String(t.sort));
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="btn-mini danger"
                            disabled={pending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  used > 0
                                    ? `${used} talk${used === 1 ? "" : "s"} use "${t.name}". Archiving takes it off the Library filters — the talks keep the tag if you bring it back. Continue?`
                                    : `Archive "${t.name}"?`,
                                )
                              ) {
                                run(() => archiveTopic(t.id));
                              }
                            }}
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {/* Adding lives where the list lives — no separate form to hunt for. */}
            <tr className="topic-add-row">
              <td>
                <input
                  className="topic-inline-input"
                  value={newName}
                  placeholder="New category — e.g. Negotiation & Influence"
                  aria-label="New category name"
                  onChange={(e) => setNewName(e.target.value)}
                />
              </td>
              <td>
                <input
                  className="topic-inline-input"
                  inputMode="numeric"
                  value={newSort}
                  aria-label="New category sort order"
                  onChange={(e) => setNewSort(e.target.value)}
                />
              </td>
              <td />
              <td>
                <button
                  type="button"
                  className="btn-purple"
                  disabled={pending || !newName.trim()}
                  onClick={() =>
                    run(async () => {
                      const res = await createTopic(newName, newSort);
                      if (res.ok) setNewName("");
                      return res;
                    })
                  }
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Assignments ──────────────────────────────────────────────── */}
      <div className="section-header">
        <div>
          <h2>What&apos;s filed where</h2>
          <p>
            One primary category per talk, plus any secondaries. Recordings
            inherit their session&apos;s categories automatically — edit either
            here.
          </p>
        </div>
        <input
          className="topic-search"
          value={search}
          placeholder="Search talks or speakers…"
          aria-label="Search talks"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Talk</th>
              <th>Primary</th>
              <th>Secondary</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={4} className="topic-empty">
                  {items.length === 0
                    ? "Nothing to categorize yet — sessions and recordings appear here as they're added."
                    : "No talks match that search."}
                </td>
              </tr>
            )}
            {visibleItems.map((item) => {
              const open = openItem === item.id;
              return (
                <Fragment key={item.id}>
                  <tr>
                    <td>
                      <div className="admin-row-title">{item.title}</div>
                      <div className="cc-sub">
                        {item.speakerName || "—"}
                        <span className="topic-kind">
                          {item.kind === "video" ? "Recording" : "Session"}
                        </span>
                      </div>
                    </td>
                    <td>
                      {item.primaryId ? (
                        <span className="topic-chip primary">
                          {topicName.get(item.primaryId) ?? "—"}
                        </span>
                      ) : (
                        <span className="cc-sub">None</span>
                      )}
                    </td>
                    <td>
                      {item.secondaryIds.length > 0 ? (
                        <div className="topic-chip-row">
                          {item.secondaryIds.map((id) => (
                            <span key={id} className="topic-chip">
                              {topicName.get(id) ?? "—"}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="cc-sub">None</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => (open ? setOpenItem(null) : openEditor(item))}
                      >
                        {open ? "Close" : "Edit"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="topic-editor-row">
                      <td colSpan={4}>
                        <div className="topic-editor">
                          <div className="admin-field" style={{ maxWidth: 420 }}>
                            <label htmlFor={`primary-${item.id}`}>
                              Primary category
                            </label>
                            <select
                              id={`primary-${item.id}`}
                              value={draft.primaryId ?? ""}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  primaryId: e.target.value || null,
                                  secondaryIds: d.secondaryIds.filter(
                                    (x) => x !== e.target.value,
                                  ),
                                }))
                              }
                            >
                              <option value="">— none —</option>
                              {topics.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="admin-field">
                            <label>Secondary categories</label>
                            <div className="topic-checks">
                              {topics
                                .filter((t) => t.id !== draft.primaryId)
                                .map((t) => (
                                  <label key={t.id} className="cc-check-row">
                                    <input
                                      type="checkbox"
                                      checked={draft.secondaryIds.includes(t.id)}
                                      onChange={(e) =>
                                        setDraft((d) => ({
                                          ...d,
                                          secondaryIds: e.target.checked
                                            ? [...d.secondaryIds, t.id]
                                            : d.secondaryIds.filter(
                                                (x) => x !== t.id,
                                              ),
                                        }))
                                      }
                                    />
                                    {t.name}
                                  </label>
                                ))}
                            </div>
                          </div>
                          <div className="admin-form-actions">
                            <button
                              type="button"
                              className="btn-purple"
                              disabled={pending}
                              onClick={() => {
                                run(() =>
                                  setTopics(
                                    item.kind,
                                    item.id,
                                    draft.primaryId,
                                    draft.secondaryIds,
                                  ),
                                );
                                setOpenItem(null);
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={() => setOpenItem(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
