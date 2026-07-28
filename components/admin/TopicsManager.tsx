"use client";

import { useState, useTransition } from "react";
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

  // Draft assignments, keyed by item — edits are local until Save so a
  // half-set primary never reaches the one-primary index.
  const [draft, setDraft] = useState<
    Record<string, { primaryId: string | null; secondaryIds: string[] }>
  >({});

  function run(fn: () => Promise<TopicResult>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      if (res.ok) router.refresh();
    });
  }

  function stateFor(item: TaggableItem) {
    return (
      draft[item.id] ?? {
        primaryId: item.primaryId,
        secondaryIds: item.secondaryIds,
      }
    );
  }

  function patch(
    item: TaggableItem,
    next: Partial<{ primaryId: string | null; secondaryIds: string[] }>,
  ) {
    setDraft((d) => ({ ...d, [item.id]: { ...stateFor(item), ...next } }));
  }

  return (
    <>
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} role="status">
          {msg.text}
        </div>
      )}

      <div className="section-header">
        <div>
          <h2>Categories</h2>
          <p>
            What members browse the Library by. Add one whenever a new speaker
            brings a subject that isn&apos;t here yet — nothing needs
            redeploying.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="admin-field">
          <label htmlFor="topic-name">New category</label>
          <input
            id="topic-name"
            value={newName}
            placeholder="Negotiation & Influence"
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="topic-sort">Sort — lower shows first</label>
          <input
            id="topic-sort"
            inputMode="numeric"
            value={newSort}
            onChange={(e) => setNewSort(e.target.value)}
          />
        </div>
        <div className="admin-form-actions">
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
            Add category
          </button>
        </div>
      </div>

      <div className="card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Sort</th>
                <th>Used by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => {
                const used = items.filter(
                  (i) => i.primaryId === t.id || i.secondaryIds.includes(t.id),
                ).length;
                return (
                  <tr key={t.id}>
                    <td>
                      {editId === t.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label="Category name"
                        />
                      ) : (
                        <div className="admin-row-title">{t.name}</div>
                      )}
                    </td>
                    <td>
                      {editId === t.id ? (
                        <input
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
                        {editId === t.id ? (
                          <>
                            <button
                              type="button"
                              className="btn-purple"
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
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-mini danger"
                              disabled={pending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    used > 0
                                      ? `${used} item${used === 1 ? "" : "s"} use "${t.name}". Archiving takes it off the Library filters — the items keep the tag if you bring it back. Continue?`
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
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-header">
        <div>
          <h2>What&apos;s filed where</h2>
          <p>
            One primary category each, plus any number of secondary ones. A
            recording inherits its session&apos;s categories when it&apos;s
            created; change either here.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="cc-note">
            Nothing to categorise yet — sessions and recordings show up here as
            they&apos;re added.
          </p>
        </div>
      ) : (
        items.map((item) => {
          const state = stateFor(item);
          const dirty = Boolean(draft[item.id]);
          return (
            <div className="card" key={`${item.kind}-${item.id}`}>
              <div className="card-header">
                <h3>
                  {item.title}
                  <span className="topic-kind">
                    {item.kind === "video" ? "Recording" : "Session"}
                  </span>
                </h3>
              </div>
              <div className="admin-field">
                <label htmlFor={`primary-${item.id}`}>Primary category</label>
                <select
                  id={`primary-${item.id}`}
                  value={state.primaryId ?? ""}
                  onChange={(e) =>
                    patch(item, { primaryId: e.target.value || null })
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
                    .filter((t) => t.id !== state.primaryId)
                    .map((t) => (
                      <label key={t.id} className="cc-check-row">
                        <input
                          type="checkbox"
                          checked={state.secondaryIds.includes(t.id)}
                          onChange={(e) =>
                            patch(item, {
                              secondaryIds: e.target.checked
                                ? [...state.secondaryIds, t.id]
                                : state.secondaryIds.filter((x) => x !== t.id),
                            })
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
                  disabled={pending || !dirty}
                  onClick={() => {
                    run(() =>
                      setTopics(
                        item.kind,
                        item.id,
                        state.primaryId,
                        state.secondaryIds,
                      ),
                    );
                    setDraft((d) => {
                      const next = { ...d };
                      delete next[item.id];
                      return next;
                    });
                  }}
                >
                  {dirty ? "Save categories" : "Saved"}
                </button>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
