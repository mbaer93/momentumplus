"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveTier,
  createTier,
  setFeatureLaunched,
  setTierFeature,
  setTierPublic,
  updateTier,
  type ControlResult,
  type TierInput,
} from "@/app/(portal)/admin/control-center/actions";
import { LockIcon } from "@/components/icons";
import type { AccessMatrix, LibraryScope, TierDef } from "@/lib/tiers";

const SCOPE_LABEL: Record<LibraryScope, string> = {
  none: "No Library",
  current_season: "Current season only",
  all_seasons: "Every season, including the archive",
};

const EMPTY_TIER: TierInput = {
  label: "",
  description: "",
  rank: "500",
  libraryScope: "current_season",
  clearsVipPlus: false,
  clearsProOnly: false,
  countsTowardSpeakerPay: true,
};

function toInput(t: TierDef): TierInput {
  return {
    label: t.label,
    description: t.description,
    rank: String(t.rank),
    libraryScope: t.libraryScope,
    clearsVipPlus: t.clearsVipPlus,
    clearsProOnly: t.clearsProOnly,
    countsTowardSpeakerPay: t.countsTowardSpeakerPay,
  };
}

export function ControlCenter({
  matrix,
  memberCounts,
}: {
  matrix: AccessMatrix;
  /** Live members per tier — what a Go Live or a restriction would touch. */
  memberCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<TierInput>(EMPTY_TIER);
  const [creating, setCreating] = useState(false);

  // Archived tiers are history — they stay out of the grid and the switches.
  const tiers = matrix.tiers.filter((t) => !t.archivedAt);

  function run(fn: () => Promise<ControlResult>, silent = false) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok || (!silent && res.message)) {
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      }
      if (res.ok) router.refresh();
    });
  }

  function saveTier() {
    const input = form;
    run(async () =>
      editing && !creating ? updateTier(editing, input) : createTier(input),
    );
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_TIER);
  }

  return (
    <>
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`} role="status">
          {msg.text}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <div className="section-header">
        <div>
          <h2>Launch</h2>
          <p>
            What the public can see and buy. A tier that isn&apos;t live still
            exists — you can put a member on it from the admin panel to test
            it — it just appears in no pricing grid and no checkout.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Membership tiers</h3>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Members</th>
                <th>Library</th>
                <th>Counts for speakers</th>
                <th>On sale</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.slug}>
                  <td>
                    <div className="admin-row-title">{t.label}</div>
                    <div className="cc-sub">{t.description || t.slug}</div>
                  </td>
                  <td>{memberCounts[t.slug] ?? 0}</td>
                  <td>{SCOPE_LABEL[t.libraryScope]}</td>
                  <td>{t.countsTowardSpeakerPay ? "Yes" : "No"}</td>
                  <td>
                    <div className="admin-actions-cell">
                      <span
                        className={`admin-status ${t.isPublic ? "live" : "draft"}`}
                      >
                        {t.isPublic ? "Live" : "Hidden"}
                      </span>
                      <button
                        type="button"
                        className={t.isPublic ? "btn-mini" : "btn-purple"}
                        disabled={pending}
                        onClick={() => {
                          if (
                            t.isPublic &&
                            !window.confirm(
                              `Take ${t.label} off the public site? Existing members keep their access; nobody new can buy it.`,
                            )
                          ) {
                            return;
                          }
                          if (
                            !t.isPublic &&
                            !window.confirm(
                              `Put ${t.label} on sale? It appears in pricing and checkout straight away.`,
                            )
                          ) {
                            return;
                          }
                          run(() => setTierPublic(t.slug, !t.isPublic));
                        }}
                      >
                        {t.isPublic ? "Take off sale" : "Go live"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Features</h3>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Where</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {matrix.features.map((f) => (
                <tr key={f.key}>
                  <td>
                    <div className="admin-row-title">{f.label}</div>
                    <div className="cc-sub">{f.description}</div>
                  </td>
                  <td>{f.navHref ?? "—"}</td>
                  <td>
                    <div className="admin-actions-cell">
                      <span
                        className={`admin-status ${f.isLaunched ? "live" : "draft"}`}
                      >
                        {f.isLaunched ? "Live" : "Admins only"}
                      </span>
                      <button
                        type="button"
                        className={f.isLaunched ? "btn-mini" : "btn-purple"}
                        disabled={pending}
                        onClick={() =>
                          run(() => setFeatureLaunched(f.key, !f.isLaunched))
                        }
                      >
                        {f.isLaunched ? "Pull back" : "Go live"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="section-header">
        <div>
          <h2>Who reaches what</h2>
          <p>
            Tick to grant, untick to restrict. Members always see every tab —
            the ones outside their tier carry a padlock{" "}
            <span className="cc-inline-lock">
              <LockIcon size={12} />
            </span>{" "}
            and lead to the upgrade page, so nobody has to guess what the next
            tier up would buy them.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="admin-table-wrap">
          <table className="admin-table cc-grid">
            <thead>
              <tr>
                <th>Feature</th>
                {tiers.map((t) => (
                  <th key={t.slug} className="cc-tier-head">
                    {t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.features.map((f) => (
                <tr key={f.key}>
                  <td>
                    <div className="admin-row-title">{f.label}</div>
                    {!f.isLaunched && (
                      <div className="cc-sub">
                        Not launched — admins only whatever is ticked here.
                      </div>
                    )}
                  </td>
                  {tiers.map((t) => {
                    const allowed = matrix.grants[t.slug]?.[f.key] === true;
                    return (
                      <td key={t.slug} className="cc-cell">
                        <label className="cc-check">
                          <input
                            type="checkbox"
                            checked={allowed}
                            disabled={pending || t.slug === "admin"}
                            onChange={(e) =>
                              run(
                                () =>
                                  setTierFeature(t.slug, f.key, e.target.checked),
                                true,
                              )
                            }
                          />
                          <span className="cc-sr">
                            {t.label} can reach {f.label}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cc-note">
          Administrators are fixed at full access — locking yourself out of the
          Control Center is not a recoverable mistake.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="section-header">
        <div>
          <h2>Member types</h2>
          <p>
            Add a type of member and decide what it reaches. New types start
            hidden and with nothing granted.
          </p>
        </div>
        <button
          type="button"
          className="btn-purple"
          onClick={() => {
            setCreating(true);
            setEditing("__new__");
            setForm(EMPTY_TIER);
          }}
        >
          Add a member type
        </button>
      </div>

      {editing && (
        <div className="card">
          <div className="card-header">
            <h3>{creating ? "New member type" : "Edit member type"}</h3>
          </div>
          <div className="admin-field">
            <label htmlFor="cc-label">Name</label>
            <input
              id="cc-label"
              value={form.label}
              placeholder="Networking Member"
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="cc-desc">Description</label>
            <input
              id="cc-desc"
              value={form.description}
              placeholder="Networking groups only."
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="cc-rank">
              Rank — lower sits above. Momentum+ Member is 100.
            </label>
            <input
              id="cc-rank"
              inputMode="numeric"
              value={form.rank}
              onChange={(e) => setForm({ ...form, rank: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="cc-scope">Library</label>
            <select
              id="cc-scope"
              value={form.libraryScope}
              onChange={(e) =>
                setForm({ ...form, libraryScope: e.target.value as LibraryScope })
              }
            >
              {(Object.keys(SCOPE_LABEL) as LibraryScope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-field">
            <label className="cc-check-row">
              <input
                type="checkbox"
                checked={form.clearsVipPlus}
                onChange={(e) =>
                  setForm({ ...form, clearsVipPlus: e.target.checked })
                }
              />
              Sees content marked Exclusive
            </label>
            <label className="cc-check-row">
              <input
                type="checkbox"
                checked={form.clearsProOnly}
                onChange={(e) =>
                  setForm({ ...form, clearsProOnly: e.target.checked })
                }
              />
              Sees content marked Pro
            </label>
            <label className="cc-check-row">
              <input
                type="checkbox"
                checked={form.countsTowardSpeakerPay}
                onChange={(e) =>
                  setForm({
                    ...form,
                    countsTowardSpeakerPay: e.target.checked,
                  })
                }
              />
              Counts as a monthly user for speaker numbers and pay
            </label>
          </div>
          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-purple"
              disabled={pending}
              onClick={saveTier}
            >
              {creating ? "Create" : "Save"}
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                setEditing(null);
                setCreating(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member type</th>
                <th>Id</th>
                <th>Rank</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.slug}>
                  <td>
                    <div className="admin-row-title">{t.label}</div>
                    <div className="cc-sub">{t.description}</div>
                  </td>
                  <td>
                    <code>{t.slug}</code>
                  </td>
                  <td>{t.rank}</td>
                  <td>
                    <div className="admin-actions-cell">
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => {
                          setCreating(false);
                          setEditing(t.slug);
                          setForm(toInput(t));
                        }}
                      >
                        Edit
                      </button>
                      {!t.isBuiltin && (
                        <button
                          type="button"
                          className="btn-mini danger"
                          disabled={pending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Archive ${t.label}? It disappears from every list. Members already on it must be moved first.`,
                              )
                            ) {
                              run(() => archiveTier(t.slug));
                            }
                          }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
