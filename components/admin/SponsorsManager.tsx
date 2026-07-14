"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSponsor,
  deleteSponsor,
  toggleRail,
  type SponsorInput,
} from "@/app/(portal)/admin/sponsors/actions";

export interface AdminSponsorRow {
  id: string;
  name: string;
  tier: string;
  tagline: string;
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

export function SponsorsManager({ sponsors }: { sponsors: AdminSponsorRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState<SponsorInput>(EMPTY);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.message ?? null);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field-row" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <div className="admin-field">
            <label htmlFor="sp-name">New sponsor — name</label>
            <input
              id="sp-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Business name"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="sp-tier">Tier</label>
            <select
              id="sp-tier"
              value={form.tier}
              onChange={(e) =>
                setForm({ ...form, tier: e.target.value as SponsorInput["tier"] })
              }
            >
              <option value="title">Title</option>
              <option value="partner">Partner</option>
              <option value="community">Community</option>
            </select>
          </div>
        </div>
        <div className="admin-field-row">
          <div className="admin-field">
            <label htmlFor="sp-tagline">Tagline</label>
            <input
              id="sp-tagline"
              value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="sp-website">Website</label>
            <input
              id="sp-website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://…"
            />
          </div>
        </div>
        <div className="admin-field">
          <label htmlFor="sp-offer">Member offer (optional)</label>
          <input
            id="sp-offer"
            value={form.offer}
            onChange={(e) => setForm({ ...form, offer: e.target.value })}
          />
        </div>
        <div className="admin-form-actions">
          <label className="admin-check-row" style={{ marginRight: 8 }}>
            <input
              type="checkbox"
              className="pref-toggle"
              checked={form.railActive}
              onChange={(e) => setForm({ ...form, railActive: e.target.checked })}
            />
            Show in sponsor rail
          </label>
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
          {msg && <span className="admin-form-msg ok">{msg}</span>}
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Sponsor</th>
              <th>Tier</th>
              <th>Rail</th>
              <th>Impressions</th>
              <th>Clicks</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sponsors.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="admin-row-title">{s.name}</div>
                  <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                    {s.tagline}
                  </div>
                </td>
                <td style={{ textTransform: "capitalize" }}>{s.tier}</td>
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
                  <div className="admin-actions-cell" style={{ justifyContent: "flex-end" }}>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
