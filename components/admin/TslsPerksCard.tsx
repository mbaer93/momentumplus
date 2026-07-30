"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTslsPerksAction } from "@/app/(portal)/admin/billing/actions";
import type { TslsPerks } from "@/lib/tsls-perks";

/*
 * The TSLS ticket perk editor: what members see on their dashboard as
 * their next-year ticket discount. One card, edited and saved whole.
 */

export function TslsPerksCard({ initial }: { initial: TslsPerks }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<TslsPerks>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof TslsPerks>(key: K, value: TslsPerks[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function save() {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await saveTslsPerksAction(form);
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
        if (res.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "Something went wrong — try again." });
      }
    });
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <h3 style={{ marginTop: 0 }}>TSLS ticket perk</h3>
      <p style={{ fontSize: 13, color: "var(--mid-gray)", marginTop: 4 }}>
        A dashboard card offering members a discount on next year&apos;s
        Tri-State Leadership Summit tickets. Members see it only while
        it&apos;s turned on.
      </p>

      <div className="admin-form" style={{ maxWidth: "none" }}>
        <div className="admin-field">
          <label htmlFor="perk-headline">Headline</label>
          <input
            id="perk-headline"
            type="text"
            value={form.headline}
            placeholder="Members save on TSLS 2027 tickets"
            onChange={(e) => set("headline", e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="perk-blurb">Blurb</label>
          <textarea
            id="perk-blurb"
            rows={2}
            value={form.blurb}
            placeholder="Your membership includes an exclusive discount on next year's summit — grab your seat early."
            onChange={(e) => set("blurb", e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="perk-code">Discount code (optional)</label>
          <input
            id="perk-code"
            type="text"
            value={form.code}
            placeholder="MOMENTUM20"
            onChange={(e) => set("code", e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="perk-url">Ticket link</label>
          <input
            id="perk-url"
            type="url"
            value={form.url}
            placeholder="https://event.tristateleadershipsummit.com/register-general"
            onChange={(e) => set("url", e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              style={{ width: "auto" }}
            />
            Show the perk on member dashboards
          </label>
        </div>
      </div>

      <div className="admin-form-actions" style={{ marginTop: 6 }}>
        <button type="button" className="btn-purple" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save perk"}
        </button>
        {msg && (
          <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
