"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAd,
  deleteAd,
  moveAd,
  updateAd,
  type AdInput,
  type AdResult,
} from "@/app/(portal)/admin/ads/actions";
import { adStatus, type AdCreative, type AdPlacement } from "@/lib/ads-shared";

const EMPTY: AdInput = {
  placementKey: "",
  kind: "ad",
  title: "",
  body: "",
  ctaLabel: "",
  url: "",
  imageUrl: "",
  sponsorId: "",
  active: true,
  startsAt: "",
  endsAt: "",
  tiers: [],
};

/** ISO → the value a datetime-local input wants, in Eastern. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function toInput(a: AdCreative): AdInput {
  return {
    placementKey: a.placementKey,
    kind: a.kind,
    title: a.title,
    body: a.body,
    ctaLabel: a.ctaLabel,
    url: a.url,
    imageUrl: a.imageUrl ?? "",
    sponsorId: a.sponsorId ?? "",
    active: a.active,
    startsAt: toLocalInput(a.startsAt),
    endsAt: toLocalInput(a.endsAt),
    tiers: a.tiers,
  };
}

export function AdsManager({
  placements,
  ads,
  sponsors,
  memberTypes,
  needsMigration,
}: {
  placements: AdPlacement[];
  ads: AdCreative[];
  sponsors: {
    id: string;
    name: string;
    tagline?: string;
    sidebarAdUrl?: string | null;
  }[];
  /** Every live member type, for tier targeting. */
  memberTypes: { slug: string; label: string }[];
  needsMigration: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<AdInput>(EMPTY);

  // The form opens above the placement tables; an Edit clicked on a row
  // further down the page would otherwise open it out of view — which
  // reads as the button doing nothing (Matt, 2026-07-28).
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (editing) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [editing]);

  function run(fn: () => Promise<AdResult>, silent = false) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok || (!silent && res.message)) {
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      }
      if (res.ok) router.refresh();
    });
  }

  // The sponsor the open form is linked to — its profile values render as
  // placeholders, since blank fields inherit them (Matt, 2026-07-28: an
  // all-blank seeded row read as "none of the actual content is there").
  const linked = form.sponsorId
    ? sponsors.find((s) => s.id === form.sponsorId)
    : undefined;

  function save() {
    const input = form;
    const id = editing;
    run(async () => (id && id !== "__new__" ? updateAd(id, input) : createAd(input)));
    setEditing(null);
    setForm(EMPTY);
  }

  if (needsMigration) {
    return (
      <div className="admin-hint">
        Run <code>0056_ad_manager.sql</code> in Supabase to turn on the ad
        manager.
      </div>
    );
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
          <h2>Placements</h2>
          <p>
            Every slot a banner or notice can occupy. Within a slot, the order
            here is the order members see — use the arrows to move a creative
            up or down.
          </p>
        </div>
        <button
          type="button"
          className="btn-purple"
          onClick={() => {
            setEditing("__new__");
            setForm({ ...EMPTY, placementKey: placements[0]?.key ?? "" });
          }}
        >
          Add an ad or notice
        </button>
      </div>

      {editing && (
        <div
          ref={formRef}
          className="admin-form"
          /* scrollMarginTop keeps the form clear of the sticky topbar. */
          style={{ marginBottom: 24, scrollMarginTop: 84 }}
        >
          <h3 className="admin-form-title">
            {editing === "__new__" ? "New ad or notice" : "Edit ad or notice"}
          </h3>
          <div className="admin-field">
            <label htmlFor="ad-placement">Where it appears</label>
            <select
              id="ad-placement"
              value={form.placementKey}
              onChange={(e) => setForm({ ...form, placementKey: e.target.value })}
            >
              {placements.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} — {p.description}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="ad-kind">Type</label>
              <select
                id="ad-kind"
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as "ad" | "notice" })
                }
              >
                <option value="ad">Ad — a paid or sponsor placement</option>
                <option value="notice">Notice — house copy, no advertiser</option>
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="ad-sponsor">Sponsor — feeds their analytics</label>
              <select
                id="ad-sponsor"
                value={form.sponsorId}
                onChange={(e) => setForm({ ...form, sponsorId: e.target.value })}
              >
                <option value="">— none (house notice) —</option>
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {form.sponsorId && (
            <p className="cc-sub" style={{ margin: "-8px 0 16px" }}>
              Sponsor-linked: any field left blank inherits from the
              sponsor&apos;s profile — name, tagline, uploaded ad creative,
              and a link to their page. Fill a field here to override it.
            </p>
          )}
          <div className="admin-field">
            <label htmlFor="ad-title">Headline</label>
            <input
              id="ad-title"
              value={form.title}
              placeholder={linked ? `${linked.name} (from their profile)` : ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="ad-body">Body</label>
            <textarea
              id="ad-body"
              rows={2}
              value={form.body}
              placeholder={
                linked?.tagline ? `${linked.tagline} (from their profile)` : ""
              }
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="ad-cta">Button label</label>
              <input
                id="ad-cta"
                value={form.ctaLabel}
                placeholder="Learn more"
                onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="ad-url">Link</label>
              <input
                id="ad-url"
                value={form.url}
                placeholder={
                  linked
                    ? "Their sponsor profile page"
                    : "https://… or a site page like /upgrade"
                }
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
          </div>
          <div className="admin-field">
            <label htmlFor="ad-image">Image URL</label>
            <input
              id="ad-image"
              value={form.imageUrl}
              placeholder={
                linked?.sidebarAdUrl
                  ? "Their uploaded ad creative (from their profile)"
                  : ""
              }
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label>Who sees it</label>
            <div className="topic-checks">
              {memberTypes.map((t) => (
                <label key={t.slug} className="cc-check-row">
                  <input
                    type="checkbox"
                    checked={form.tiers.includes(t.slug)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        tiers: e.target.checked
                          ? [...form.tiers, t.slug]
                          : form.tiers.filter((x) => x !== t.slug),
                      })
                    }
                  />
                  {t.label}
                </label>
              ))}
            </div>
            <p className="cc-sub">
              Nothing ticked = every member sees it. Tick member types to show
              it only to them.
            </p>
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="ad-start">Starts (optional, Eastern)</label>
              <input
                id="ad-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="ad-end">Ends (optional, Eastern)</label>
              <input
                id="ad-end"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </div>
          </div>
          <div className="admin-field">
            <label className="cc-check-row">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Running
            </label>
          </div>
          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-purple"
              disabled={pending}
              onClick={save}
            >
              {editing === "__new__" ? "Add" : "Save"}
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {placements.map((p) => {
        const inSlot = ads
          .filter((a) => a.placementKey === p.key)
          .sort((a, b) => a.sort - b.sort);
        return (
          <div key={p.key}>
            <div className="ads-slot-head">
              <h3>{p.label}</h3>
              <p>{p.description}</p>
            </div>
            {inSlot.length === 0 ? (
              <p className="cc-sub">Nothing in this slot yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Creative</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {inSlot.map((a, i) => {
                      const status = adStatus(a);
                      return (
                        <tr key={a.id}>
                          <td>
                            <div className="admin-actions-cell">
                              <button
                                type="button"
                                className="btn-mini"
                                aria-label={`Move ${a.title} up`}
                                disabled={pending || i === 0}
                                onClick={() => run(() => moveAd(a.id, "up"), true)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn-mini"
                                aria-label={`Move ${a.title} down`}
                                disabled={pending || i === inSlot.length - 1}
                                onClick={() => run(() => moveAd(a.id, "down"), true)}
                              >
                                ↓
                              </button>
                            </div>
                          </td>
                          <td>
                            <div className="admin-row-title">
                              {a.title ||
                                sponsors.find((s) => s.id === a.sponsorId)
                                  ?.name ||
                                "Untitled"}
                            </div>
                            <div className="cc-sub">
                              {a.kind === "notice" ? "Notice" : "Ad"}
                              {a.body
                                ? ` — ${a.body.slice(0, 60)}`
                                : !a.title && a.sponsorId
                                  ? " — creative comes from the sponsor's profile"
                                  : ""}
                            </div>
                            {a.tiers.length > 0 && (
                              <div className="cc-sub">
                                Only:{" "}
                                {a.tiers
                                  .map(
                                    (slug) =>
                                      memberTypes.find(
                                        (t) => t.slug === slug,
                                      )?.label ?? slug,
                                  )
                                  .join(", ")}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`admin-status ${status.tone}`}>
                              {status.label}
                            </span>
                          </td>
                          <td>
                            <div className="admin-actions-cell">
                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() => {
                                  setEditing(a.id);
                                  setForm(toInput(a));
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
                                      `Delete "${a.title}"? This can't be undone — switch it off instead if you might run it again.`,
                                    )
                                  ) {
                                    run(() => deleteAd(a.id));
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
