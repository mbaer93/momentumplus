"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/*
 * Generic admin CRUD manager (speakers / resources / videos). Pages supply
 * field definitions, rows, and server actions; this renders the create form,
 * the table, and per-row inline editing (opened directly via ?edit=<id> from
 * the member-facing Edit buttons).
 */

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}

export type EntityValues = Record<string, string | number | boolean>;

export interface EntityRow {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  values: EntityValues;
}

interface ActionResult {
  ok: boolean;
  message?: string;
}

interface EntityManagerProps {
  entityLabel: string;
  fields: FieldDef[];
  rows: EntityRow[];
  emptyValues: EntityValues;
  initialEditId?: string;
  /** Hide the create form when creation happens elsewhere (e.g. video upload). */
  allowCreate?: boolean;
  onCreate: (values: EntityValues) => Promise<ActionResult>;
  onUpdate: (id: string, values: EntityValues) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
}

function Fields({
  fields,
  values,
  onChange,
  idPrefix,
}: {
  fields: FieldDef[];
  values: EntityValues;
  onChange: (v: EntityValues) => void;
  idPrefix: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const wide = f.type === "textarea";
        return (
          <div
            className="admin-field"
            key={f.key}
            style={wide ? { gridColumn: "1 / -1" } : undefined}
          >
            {f.type !== "checkbox" && <label htmlFor={id}>{f.label}</label>}
            {f.type === "text" && (
              <input
                id={id}
                value={String(values[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              />
            )}
            {f.type === "number" && (
              <input
                id={id}
                type="number"
                min={0}
                value={Number(values[f.key] ?? 0)}
                onChange={(e) =>
                  onChange({ ...values, [f.key]: Number(e.target.value) })
                }
              />
            )}
            {f.type === "textarea" && (
              <textarea
                id={id}
                value={String(values[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              />
            )}
            {f.type === "select" && (
              <select
                id={id}
                value={String(values[f.key] ?? "")}
                onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {f.type === "checkbox" && (
              <label className="admin-check-row" htmlFor={id} style={{ marginTop: 26 }}>
                <input
                  id={id}
                  type="checkbox"
                  className="pref-toggle"
                  checked={Boolean(values[f.key])}
                  onChange={(e) =>
                    onChange({ ...values, [f.key]: e.target.checked })
                  }
                />
                {f.label}
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EntityManager({
  entityLabel,
  fields,
  rows,
  emptyValues,
  initialEditId,
  allowCreate = true,
  onCreate,
  onUpdate,
  onDelete,
}: EntityManagerProps) {
  const router = useRouter();
  const [createValues, setCreateValues] = useState<EntityValues>(emptyValues);
  const [editingId, setEditingId] = useState<string | null>(initialEditId ?? null);
  const seed = rows.find((r) => r.id === editingId);
  const [editValues, setEditValues] = useState<EntityValues>(
    seed ? { ...seed.values } : emptyValues,
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const requiredOk = (v: EntityValues) =>
    fields
      .filter((f) => f.required)
      .every((f) => String(v[f.key] ?? "").trim().length > 0);

  function run(fn: () => Promise<ActionResult>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ?? null);
        if (res.ok) router.refresh();
      } catch {
        setMsg("That didn't save — please try again.");
      }
    });
  }

  return (
    <div>
      {allowCreate && (
        <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
          <div className="admin-field" style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 13 }}>Add {entityLabel}</label>
          </div>
          <Fields
            fields={fields}
            values={createValues}
            onChange={setCreateValues}
            idPrefix="new"
          />
          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-purple"
              disabled={pending || !requiredOk(createValues)}
              onClick={() =>
                run(async () => {
                  const res = await onCreate(createValues);
                  if (res.ok) setCreateValues(emptyValues);
                  return res;
                })
              }
            >
              Add {entityLabel}
            </button>
            {msg && <span className="admin-form-msg ok">{msg}</span>}
          </div>
        </div>
      )}
      {!allowCreate && msg && (
        <div className="admin-form-msg ok" style={{ marginBottom: 10 }}>
          {msg}
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{entityLabel[0].toUpperCase() + entityLabel.slice(1)}</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: "var(--mid-gray)" }}>
                  Nothing here yet — add the first {entityLabel} above.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <div className="admin-row-title">{r.title}</div>
                    <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                      {r.subtitle}
                    </div>
                  </td>
                  <td>
                    {r.badge ? (
                      <span className="admin-status draft">{r.badge}</span>
                    ) : (
                      <span style={{ color: "var(--mid-gray)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    <div
                      className="admin-actions-cell"
                      style={{ justifyContent: "flex-end" }}
                    >
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => {
                          if (editingId === r.id) {
                            setEditingId(null);
                          } else {
                            setEditingId(r.id);
                            setEditValues({ ...r.values });
                          }
                        }}
                      >
                        {editingId === r.id ? "Close" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className="btn-mini danger"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Delete "${r.title}"?`)) {
                            run(async () => {
                              const res = await onDelete(r.id);
                              if (res.ok && editingId === r.id) setEditingId(null);
                              return res;
                            });
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === r.id && (
                  <tr>
                    <td colSpan={3} style={{ background: "#fbfaf8" }}>
                      <div style={{ padding: "6px 4px" }}>
                        <Fields
                          fields={fields}
                          values={editValues}
                          onChange={setEditValues}
                          idPrefix={`edit-${r.id}`}
                        />
                        <div className="admin-form-actions" style={{ marginTop: 4 }}>
                          <button
                            type="button"
                            className="btn-purple"
                            disabled={pending || !requiredOk(editValues)}
                            onClick={() =>
                              run(async () => {
                                const res = await onUpdate(r.id, editValues);
                                if (res.ok) setEditingId(null);
                                return res;
                              })
                            }
                          >
                            Save changes
                          </button>
                        </div>
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
