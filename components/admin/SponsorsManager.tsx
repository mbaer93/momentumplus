"use client";

/* eslint-disable @next/next/no-img-element */

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RAIL_TIERS, SPONSOR_TIERS, sponsorTierLabel } from "@/lib/sponsor-tiers";
import {
  archiveSponsor,
  createSponsor,
  deleteSponsor,
  inviteSponsorRep,
  reinstateSponsor,
  linkSponsorMember,
  setSponsorOngoing,
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
  description: string;
  offer: string;
  website: string;
  logoUrl: string | null;
  sidebarAdUrl: string | null;
  railActive: boolean;
  impressions: number;
  clicks: number;
  /** Members holding a seat (each gets Pro while linked). */
  seats: SponsorSeat[];
  /** Sponsorship term end (October 1); null = no term. */
  expiresAt?: string | null;
  /** Set when retired to the Past Sponsors archive. */
  archivedAt?: string | null;
}

const EMPTY: SponsorInput = {
  name: "",
  tier: "partner",
  tagline: "",
  description: "",
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
            {SPONSOR_TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
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
        <label htmlFor={`${idPrefix}-description`}>
          About (shown on the sponsor&apos;s profile page)
        </label>
        <textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="A few sentences about the business — what they do and who they serve."
        />
      </div>
      <div className="admin-field">
        <label htmlFor={`${idPrefix}-offer`}>Member offer (optional)</label>
        <input
          id={`${idPrefix}-offer`}
          value={value.offer}
          onChange={(e) => onChange({ ...value, offer: e.target.value })}
        />
      </div>
      {RAIL_TIERS.has(value.tier) ? (
        <label className="admin-check-row">
          <input
            type="checkbox"
            className="pref-toggle"
            checked={value.railActive}
            onChange={(e) => onChange({ ...value, railActive: e.target.checked })}
          />
          Show in the sponsor side panel
        </label>
      ) : (
        <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
          Side-panel ads are reserved for Momentum+ Sponsor, Title, and
          Platinum tiers — this sponsor appears on the Sponsors tab.
        </div>
      )}
    </>
  );
}

export function SponsorsManager({
  sponsors,
  pastSponsors = [],
  pendingInvites = [],
  presentedByLogoUrl,
  initialEditId,
  memberOptions = [],
}: {
  sponsors: AdminSponsorRow[];
  /** Archived or term-expired sponsors — admin-only, reinstatable. */
  pastSponsors?: AdminSponsorRow[];
  /** Sponsor onboarding invites that haven't been completed yet. */
  pendingInvites?: {
    email: string;
    tier: string;
    businessName: string;
    createdAt: string;
  }[];
  /** Current site-wide "Presented by" logo (left panel), if uploaded. */
  presentedByLogoUrl?: string | null;
  initialEditId?: string;
  /** Existing members for the searchable "Link member" picker. */
  memberOptions?: { name: string; email: string }[];
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
          description: editSeed.description,
          offer: editSeed.offer,
          website: editSeed.website,
          railActive: editSeed.railActive,
        }
      : EMPTY,
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [seatEmail, setSeatEmail] = useState("");
  const [invite, setInvite] = useState({ email: "", tier: "partner", businessName: "" });
  const [inviteMsg, setInviteMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
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
      description: row.description,
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
      {/* Sponsor self-service onboarding: enter the rep's email; they fill
          in the business + their own details and get Pro access to Oct 1. */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 13 }}>Invite a sponsor</label>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
          Enter the sponsor representative&apos;s email and pick their tier.
          They get an email that walks them through adding the business and
          their own details — no data entry on your side. The rep receives
          Momentum+ Pro access, and the sponsorship runs through October 1.
        </div>
        <div className="admin-field-row" style={{ gridTemplateColumns: "1.4fr 1fr 1.2fr auto", alignItems: "end" }}>
          <div className="admin-field">
            <label htmlFor="sp-invite-email">Rep email</label>
            <input
              id="sp-invite-email"
              type="email"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              placeholder="rep@business.com"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="sp-invite-tier">Tier</label>
            <select
              id="sp-invite-tier"
              value={invite.tier}
              onChange={(e) => setInvite({ ...invite, tier: e.target.value })}
            >
              {SPONSOR_TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-field">
            <label htmlFor="sp-invite-biz">Business name (optional prefill)</label>
            <input
              id="sp-invite-biz"
              value={invite.businessName}
              onChange={(e) =>
                setInvite({ ...invite, businessName: e.target.value })
              }
              placeholder="They can edit this"
            />
          </div>
          <button
            type="button"
            className="btn-mini"
            disabled={pending || !invite.email.includes("@")}
            onClick={() => {
              setInviteMsg(null);
              setInviteLink(null);
              startTransition(async () => {
                const res = await inviteSponsorRep(
                  invite.email,
                  invite.tier,
                  invite.businessName,
                );
                setInviteMsg(
                  res.message ? { text: res.message, ok: res.ok } : null,
                );
                setInviteLink(res.loginLink ?? null);
                if (res.ok) {
                  setInvite({ email: "", tier: "partner", businessName: "" });
                  router.refresh();
                }
              });
            }}
          >
            Send invite
          </button>
        </div>
        {inviteMsg && (
          <div className={`admin-form-msg ${inviteMsg.ok ? "ok" : "err"}`}>
            {inviteMsg.text}
          </div>
        )}
        {inviteLink && (
          <div className="admin-form-actions" style={{ marginTop: 8, alignItems: "center" }}>
            <code style={{ fontSize: 11, wordBreak: "break-all", flex: 1 }}>
              {inviteLink}
            </code>
            <button
              type="button"
              className="btn-mini"
              onClick={() => void navigator.clipboard.writeText(inviteLink)}
            >
              Copy link
            </button>
          </div>
        )}
        {pendingInvites.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--mid-gray)" }}>
            Waiting on:{" "}
            {pendingInvites
              .map(
                (i) =>
                  `${i.email}${i.businessName ? ` (${i.businessName})` : ""} — ${sponsorTierLabel(i.tier)}`,
              )
              .join(" · ")}
          </div>
        )}
      </div>

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
                    {sponsorTierLabel(s.tier)}
                  </td>
                  <td>
                    {RAIL_TIERS.has(s.tier) ? (
                      <input
                        type="checkbox"
                        className="pref-toggle"
                        checked={s.railActive}
                        disabled={pending}
                        onChange={(e) => run(() => toggleRail(s.id, e.target.checked))}
                        aria-label={`${s.name} rail`}
                      />
                    ) : (
                      <span
                        style={{ fontSize: 11, color: "var(--mid-gray)" }}
                        title="Rail ads are reserved for Momentum+ Sponsor, Title, and Platinum tiers."
                      >
                        —
                      </span>
                    )}
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
                        className="btn-mini"
                        disabled={pending}
                        title={
                          s.expiresAt
                            ? "Remove the season end — they stay up until you archive them"
                            : "Put them back on the season clock (ends next October 1)"
                        }
                        onClick={() => {
                          const makeOngoing = Boolean(s.expiresAt);
                          if (
                            confirm(
                              makeOngoing
                                ? `Make ${s.name} an ongoing sponsor? Their season end date is removed — they become visible to members right away (even before October 1), never come down automatically, and their team's access doesn't expire. You can put them back on the season clock anytime.`
                                : `Put ${s.name} back on the season clock? Their sponsorship and their team's access will end next October 1.`,
                            )
                          ) {
                            run(() => setSponsorOngoing(s.id, makeOngoing));
                          }
                        }}
                      >
                        {s.expiresAt ? "Make ongoing" : "Set season end"}
                      </button>
                      <button
                        type="button"
                        className="btn-mini"
                        disabled={pending}
                        title="Move to Past Sponsors (hidden from members, reversible)"
                        onClick={() => {
                          if (
                            confirm(
                              `Archive ${s.name}? They disappear from member pages and their reps' sponsor access ends — nothing is deleted, and you can reinstate them anytime.`,
                            )
                          ) {
                            run(() => archiveSponsor(s.id));
                          }
                        }}
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        className="btn-mini danger"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Delete ${s.name}? For retiring a sponsor, Archive is usually what you want — Delete erases them permanently.`)) {
                            run(() => deleteSponsor(s.id));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>


      {/* Editor: rendered below the table (not inside a row) so it's
          fully usable on phones, where the table scrolls sideways. */}
      {editSeed && (
        <div className="card" style={{ marginTop: 14, padding: "14px 16px", background: "#fbfaf8" }}>
          <div className="admin-row-title" style={{ marginBottom: 8 }}>
            Editing {editSeed.name}
          </div>
          <div style={{ padding: "6px 4px" }}>
              <SponsorFields
                value={editForm}
                onChange={setEditForm}
                idPrefix={`edit-${editSeed.id}`}
              />
              <div className="admin-form-actions" style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className="btn-purple"
                  disabled={pending || !editForm.name.trim()}
                  onClick={() =>
                    run(async () => {
                      const res = await updateSponsor(editSeed.id, editForm);
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
                    fileRefs.current[`${editSeed.id}-logo`] = el;
                  }}
                  style={{ fontSize: 12 }}
                />
                <button
                  type="button"
                  className="btn-mini"
                  disabled={pending}
                  onClick={() => uploadImage(editSeed.id, "logo")}
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
                    fileRefs.current[`${editSeed.id}-ad`] = el;
                  }}
                  style={{ fontSize: 12 }}
                />
                <button
                  type="button"
                  className="btn-mini"
                  disabled={pending}
                  onClick={() => uploadImage(editSeed.id, "ad")}
                >
                  Upload ad graphic
                </button>
                {editSeed.sidebarAdUrl && (
                  <button
                    type="button"
                    className="btn-mini danger"
                    disabled={pending}
                    onClick={() => run(() => removeSponsorAd(editSeed.id))}
                  >
                    Remove ad
                  </button>
                )}
              </div>
              {editSeed.sidebarAdUrl && (
                <div style={{ marginTop: 8 }}>
                  <img
                    src={editSeed.sidebarAdUrl}
                    alt={`${editSeed.name} ad graphic`}
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
                {editSeed.seats.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                    No members linked yet.
                  </div>
                )}
                {editSeed.seats.map((seat) => (
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
                            unlinkSponsorMember(editSeed.id, seat.profileId),
                          );
                        }
                      }}
                    >
                      Unlink
                    </button>
                  </div>
                ))}
                <div className="admin-form-actions" style={{ marginTop: 8 }}>
                  {/* Searchable member picker: a datalist filters as the
                      admin types a name or email; a brand-new email still
                      works (it invites them through the normal flow). */}
                  <input
                    type="email"
                    list="link-member-options"
                    placeholder="Search members by name or email…"
                    value={seatEmail}
                    onChange={(e) => setSeatEmail(e.target.value)}
                    style={{ minWidth: 260 }}
                    aria-label="Member to link (search by name or email)"
                  />
                  <datalist id="link-member-options">
                    {memberOptions.map((m) => (
                      <option key={m.email} value={m.email}>
                        {m.name || m.email}
                      </option>
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className="btn-mini"
                    disabled={pending || !seatEmail.includes("@")}
                    onClick={() =>
                      run(async () => {
                        const res = await linkSponsorMember(
                          editSeed.id,
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
        </div>
      )}

      {pastSponsors.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="admin-field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 13 }}>
              Past sponsors ({pastSponsors.length}) — hidden from members
            </label>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Sponsor</th>
                  <th>Tier</th>
                  <th>Term ended</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pastSponsors.map((s) => (
                  <tr key={s.id}>
                    <td className="admin-row-title">{s.name}</td>
                    <td>{sponsorTierLabel(s.tier)}</td>
                    <td style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                      {s.archivedAt
                        ? `Archived ${new Date(s.archivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        : s.expiresAt
                          ? `Expired ${new Date(s.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : "—"}
                    </td>
                    <td>
                      <div
                        className="admin-actions-cell"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <button
                          type="button"
                          className="btn-mini"
                          disabled={pending}
                          onClick={() => {
                            if (
                              confirm(
                                `Reinstate ${s.name} as a sponsor? They become visible to members again and their reps' Pro access is restored through next October 1.`,
                              )
                            ) {
                              run(() => reinstateSponsor(s.id));
                            }
                          }}
                        >
                          Reinstate as sponsor
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
