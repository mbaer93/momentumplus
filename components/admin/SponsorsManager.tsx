"use client";

/* eslint-disable @next/next/no-img-element */

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSponsor,
  deleteSponsor,
  linkSponsorMember,
  removePresentedByLogo,
  removeSponsorAd,
  toggleRail,
  unlinkSponsorMember,
  updateSponsor,
  uploadPresentedByLogo,
  uploadSponsorAd,
  uploadSponsorLogo,
  type SponsorInput,
} from "@/app/(portal)/admin/sponsors/actions";

export interface SponsorSeat {
  profileId: string;
  name: string;
  email: string;
}

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
  /** Members holding a seat (each gets Pro while linked). */
  seats: SponsorSeat[];
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
  presentedByLogoUrl,
  initialEditId,
}: {
  sponsors: AdminSponsorRow[];
  /** Current site-wide "Presented by" logo (left panel), if uploaded. */
  presentedByLogoUrl?: string | null;
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
  const [seatEmail, setSeatEmail] = useState("");
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

  function fileProblem(file: File | undefined): string | null {
    if (!file) {
      return "No file selected — click Choose File, pick your image, then hit Upload.";
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      const ext = file.name.includes(".")
        ? `.${file.name.split(".").pop()}`
        : "that format";
      return `"${file.name}" won't work — ${ext} isn't supported. Upload a PNG, JPG, SVG, or WebP instead (in most tools: File → Export As → PNG).`;
    }
    if (file.size > 2 * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return `"${file.name}" is ${mb} MB — the limit is 2 MB. Compress it (e.g. tinypng.com) or export it at a smaller size, then try again.`;
    }
    return null;
  }

  function uploadImage(id: string, kind: "logo" | "ad" | "presented") {
    const input = fileRefs.current[`${id}-${kind}`];
    const file = input?.files?.[0];
    const problem = fileProblem(file);
    if (problem || !file) {
      setMsg({ text: problem ?? "Choose an image file first.", ok: false });
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    run(() =>
      kind === "logo"
        ? uploadSponsorLogo(id, fd)
        : kind === "ad"
          ? uploadSponsorAd(id, fd)
          : uploadPresentedByLogo(fd),
    );
  }

  return (
    <div>
      {/* Presented-by logo: one site-wide slot for the Momentum+ Sponsor. */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 13 }}>
            &ldquo;Presented by&rdquo; logo — left panel
          </label>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
          A separate logo sized for the slot under &ldquo;Presented by&rdquo; in
          the left navigation. It belongs to the current Momentum+ Sponsor (one
          at a time) and replaces whatever is there. It displays{" "}
          <strong>184&nbsp;px wide</strong> at full slot width — upload a wide
          version about <strong>368&nbsp;×&nbsp;110&nbsp;px</strong> (2× for
          sharp screens), PNG with a transparent background looks best. Without
          one, the slot falls back to the sponsor&rsquo;s regular logo.
        </div>
        <div className="admin-form-actions" style={{ marginTop: 0 }}>
          {presentedByLogoUrl && (
            <span
              style={{
                background: "var(--navy)",
                borderRadius: 4,
                padding: "8px 10px",
                display: "inline-block",
                maxWidth: 200,
              }}
            >
              <img
                src={presentedByLogoUrl}
                alt="Current presented-by logo"
                style={{ display: "block", width: "100%", height: "auto" }}
              />
            </span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            ref={(el) => {
              fileRefs.current["site-presented"] = el;
            }}
            style={{ fontSize: 12 }}
          />
          <button
            type="button"
            className="btn-mini"
            disabled={pending}
            onClick={() => uploadImage("site", "presented")}
          >
            Upload presented-by logo
          </button>
          {presentedByLogoUrl && (
            <button
              type="button"
              className="btn-mini danger"
              disabled={pending}
              onClick={() => run(() => removePresentedByLogo())}
            >
              Remove
            </button>
          )}
        </div>
      </div>

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
                            Logo — sponsor profile and cards; also the
                            left-panel fallback when no dedicated presented-by
                            logo is uploaded (PNG/JPG/SVG/WebP, &lt;2 MB):
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
                        {/* Sponsor team seats — each linked member holds Pro
                            while they keep a seat with any sponsor. */}
                        <div style={{ marginTop: 14 }}>
                          <div className="admin-field" style={{ marginBottom: 6 }}>
                            <label style={{ fontSize: 13 }}>
                              Linked members — each gets a Pro membership for
                              as long as they&apos;re linked (optional; add as
                              many as the sponsorship includes)
                            </label>
                          </div>
                          {s.seats.length === 0 && (
                            <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                              No members linked yet.
                            </div>
                          )}
                          {s.seats.map((seat) => (
                            <div
                              key={seat.profileId}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "6px 0",
                                borderBottom: "1px solid var(--warm-gray)",
                              }}
                            >
                              <div style={{ flex: 1, fontSize: 13 }}>
                                <strong>{seat.name || seat.email}</strong>
                                {seat.name && (
                                  <span
                                    style={{
                                      color: "var(--mid-gray)",
                                      marginLeft: 8,
                                      fontSize: 12,
                                    }}
                                  >
                                    {seat.email}
                                  </span>
                                )}
                              </div>
                              <span
                                className="admin-status draft"
                                style={{ fontSize: 10 }}
                              >
                                Pro
                              </span>
                              <button
                                type="button"
                                className="btn-mini danger"
                                disabled={pending}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Unlink ${seat.name || seat.email}? Their sponsor Pro access ends unless another sponsor links them.`,
                                    )
                                  ) {
                                    run(() =>
                                      unlinkSponsorMember(s.id, seat.profileId),
                                    );
                                  }
                                }}
                              >
                                Unlink
                              </button>
                            </div>
                          ))}
                          <div className="admin-form-actions" style={{ marginTop: 8 }}>
                            <input
                              type="email"
                              placeholder="member@company.com"
                              value={seatEmail}
                              onChange={(e) => setSeatEmail(e.target.value)}
                              style={{ minWidth: 220 }}
                              aria-label="Email of member to link"
                            />
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={pending || !seatEmail.includes("@")}
                              onClick={() =>
                                run(async () => {
                                  const res = await linkSponsorMember(
                                    s.id,
                                    seatEmail,
                                  );
                                  if (res.ok) setSeatEmail("");
                                  return res;
                                })
                              }
                            >
                              Link member
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
