"use client";

/* eslint-disable @next/next/no-img-element */

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSponsor,
  deleteSponsor,
  removeSponsorAd,
  toggleRail,
  updateSponsor,
  uploadSponsorAd,
  uploadSponsorLogo,
  type SponsorInput,
} from "@/app/(portal)/admin/sponsors/actions";

export interface AdminSponsorRow {
  id: string;
  name: string;
  tier: string;
  tagline: string;
  offer: string;
  website: string;
  logoUrl: string | null;
  sidebarAdUrl: string | null;
  railActive: boolean;
  impressions: number;
  clicks: number;
}

const EMPTY: SponsorInput = {
  name: "",
  tier: "community",
  tagline: "",
  offer: "",
  website: "",
  railActive: false,
};

function SponsorFields({
  value,
  onChange,
  idPrefix,
}: {
  value: SponsorInput;
  onChange: (v: SponsorInput) => void;
  idPrefix: string;
}) {
  return (
    <>
      <div className="admin-field-row" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-name`}>Name</label>
          <input
            id={`${idPrefix}-name`}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Business name"
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-tier`}>Tier</label>
          <select
            id={`${idPrefix}-tier`}
            value={value.tier}
            onChange={(e) =>
              onChange({ ...value, tier: e.target.value as SponsorInput["tier"] })
            }
          >
            <option value="title">Momentum+ Sponsor</option>
            <option value="partner">Partner</option>
            <option value="community">Community</option>
          </select>
        </div>
      </div>
      <div className="admin-field-row">
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-tagline`}>Tagline</label>
          <input
            id={`${idPrefix}-tagline`}
            value={value.tagline}
            onChange={(e) => onChange({ ...value, tagline: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`${idPrefix}-website`}>Website</label>
          <input
            id={`${idPrefix}-website`}
            value={value.website}
            onChange={(e) => onChange({ ...value, website: e.target.value })}
            placeholder="https://…"
          />
        </div>
      </div>
      <div className="admin-field">
        <label htmlFor={`${idPrefix}-offer`}>Member offer (optional)</label>
        <input
          id={`${idPrefix}-offer`}
          value={value.offer}
          onChange={(e) => onChange({ ...value, offer: e.target.value })}
        />
      </div>
      <label className="admin-check-row">
        <input
          type="checkbox"
          className="pref-toggle"
          checked={value.railActive}
          onChange={(e) => onChange({ ...value, railActive: e.target.checked })}
        />
        Show in the sponsor side panel
      </label>
    </>
  );
}

export function SponsorsManager({
  sponsors,
  initialEditId,
}: {
  sponsors: AdminSponsorRow[];
  initialEditId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SponsorInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(
    initialEditId ?? null,
  );
  const editSeed = sponsors.find((s) => s.id === editingId);
  const [editForm, setEditForm] = useState<SponsorInput>(
    editSeed
      ? {
          name: editSeed.name,
          tier: editSeed.tier as SponsorInput["tier"],
          tagline: editSeed.tagline,
          offer: editSeed.offer,
          website: editSeed.website,
          railActive: editSeed.railActive,
        }
      : EMPTY,
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        // e.g. the upload request itself was rejected before reaching us.
        setMsg({
          text: "That didn't save — check your connection and try again. If you were uploading an image, use one under 2 MB.",
          ok: false,
        });
      }
    });
  }

  function beginEdit(row: AdminSponsorRow) {
    setEditingId(row.id);
    setEditForm({
      name: row.name,
      tier: row.tier as SponsorInput["tier"],
      tagline: row.tagline,
      offer: row.offer,
      website: row.website,
      railActive: row.railActive,
    });
  }

  // Validate before uploading so problems get a specific reason and fix.
  const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

  function uploadImage(id: string, kind: "logo" | "ad") {
    const input = fileRefs.current[`${id}-${kind}`];
    const file = input?.files?.[0];
    if (!file) {
      setMsg({
        text: "No file selected — click Choose File, pick your image, then hit Upload.",
        ok: false,
      });
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      const ext = file.name.includes(".")
        ? `.${file.name.split(".").pop()}`
        : "that format";
      setMsg({
        text: `"${file.name}" won't work — ${ext} isn't supported. Upload a PNG, JPG, SVG, or WebP instead (in most tools: File → Export As → PNG).`,
        ok: false,
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      setMsg({
        text: `"${file.name}" is ${mb} MB — the limit is 2 MB. Compress it (e.g. tinypng.com) or export it at a smaller size, then try again.`,
        ok: false,
      });
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    run(() =>
      kind === "logo" ? uploadSponsorLogo(id, fd) : uploadSponsorAd(id, fd),
    );
  }

  return (
    <div>
      {/* Create */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 13 }}>Add a sponsor</label>
        </div>
        <SponsorFields value={form} onChange={setForm} idPrefix="new" />
        <div className="admin-form-actions">
          <button
            type="button"
            className="btn-purple"
            disabled={pending || !form.name.trim()}
            onClick={() =>
              run(async () => {
                const res = await createSponsor(form);
                if (res.ok) setForm(EMPTY);
                return res;
              })
            }
          >
            Add sponsor
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
              <th>Sponsor</th>
              <th>Logo</th>
              <th>Tier</th>
              <th>Rail</th>
              <th>Impr.</th>
              <th>Clicks</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sponsors.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>
                    <div className="admin-row-title">{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                      {s.tagline}
                    </div>
                  </td>
                  <td>
                    {s.logoUrl ? (
                      <img
                        src={s.logoUrl}
                        alt={`${s.name} logo`}
                        style={{ maxHeight: 32, maxWidth: 90, objectFit: "contain" }}
                      />
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--mid-gray)" }}>
                        None
                      </span>
                    )}
                    {s.sidebarAdUrl && (
                      <div style={{ fontSize: 10, color: "var(--mid-gray)" }}>
                        + ad graphic
                      </div>
                    )}
                  </td>
                  <td style={{ textTransform: "capitalize" }}>
                    {s.tier === "title" ? "Momentum+" : s.tier}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="pref-toggle"
                      checked={s.railActive}
                      disabled={pending}
                      onChange={(e) => run(() => toggleRail(s.id, e.target.checked))}
                      aria-label={`${s.name} rail`}
                    />
                  </td>
                  <td>{s.impressions.toLocaleString()}</td>
                  <td>{s.clicks.toLocaleString()}</td>
                  <td>
                    <div
                      className="admin-actions-cell"
                      style={{ justifyContent: "flex-end" }}
                    >
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() =>
                          editingId === s.id ? setEditingId(null) : beginEdit(s)
                        }
                      >
                        {editingId === s.id ? "Close" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className="btn-mini danger"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Delete ${s.name}?`)) {
                            run(() => deleteSponsor(s.id));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === s.id && (
                  <tr>
                    <td colSpan={7} style={{ background: "#fbfaf8" }}>
                      <div style={{ padding: "6px 4px" }}>
                        <SponsorFields
                          value={editForm}
                          onChange={setEditForm}
                          idPrefix={`edit-${s.id}`}
                        />
                        <div className="admin-form-actions" style={{ marginTop: 4 }}>
                          <button
                            type="button"
                            className="btn-purple"
                            disabled={pending || !editForm.name.trim()}
                            onClick={() =>
                              run(async () => {
                                const res = await updateSponsor(s.id, editForm);
                                if (res.ok) setEditingId(null);
                                return res;
                              })
                            }
                          >
                            Save changes
                          </button>
                        </div>
                        {/* Two graphics: logo (profile + cards) and the
                            left-panel sidebar ad creative. */}
                        <div className="admin-form-actions" style={{ marginTop: 10 }}>
                          <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                            Logo — sponsor profile, cards, and the left-panel
                            &ldquo;Presented by&rdquo; slot (PNG/JPG/SVG/WebP,
                            &lt;2 MB):
                          </span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                            ref={(el) => {
                              fileRefs.current[`${s.id}-logo`] = el;
                            }}
                            style={{ fontSize: 12 }}
                          />
                          <button
                            type="button"
                            className="btn-mini"
                            disabled={pending}
                            onClick={() => uploadImage(s.id, "logo")}
                          >
                            Upload logo
                          </button>
                        </div>
                        <div className="admin-form-actions" style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                            Ad graphic — shown on the sponsor&rsquo;s card in
                            the right-hand rail (roughly 400×300, &lt;2 MB):
                          </span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                            ref={(el) => {
                              fileRefs.current[`${s.id}-ad`] = el;
                            }}
                            style={{ fontSize: 12 }}
                          />
                          <button
                            type="button"
                            className="btn-mini"
                            disabled={pending}
                            onClick={() => uploadImage(s.id, "ad")}
                          >
                            Upload ad graphic
                          </button>
                          {s.sidebarAdUrl && (
                            <button
                              type="button"
                              className="btn-mini danger"
                              disabled={pending}
                              onClick={() => run(() => removeSponsorAd(s.id))}
                            >
                              Remove ad
                            </button>
                          )}
                        </div>
                        {s.sidebarAdUrl && (
                          <div style={{ marginTop: 8 }}>
                            <img
                              src={s.sidebarAdUrl}
                              alt={`${s.name} ad graphic`}
                              style={{
                                maxWidth: 180,
                                borderRadius: 4,
                                border: "1px solid var(--border)",
                              }}
                            />
                          </div>
                        )}
                        {msg && (
                          <div
                            className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
                            style={{ marginTop: 8 }}
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
