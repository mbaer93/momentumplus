"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTestimonial,
  setTestimonialStatus,
} from "@/app/(portal)/admin/testimonials/actions";

export interface AdminTestimonialRow {
  id: string;
  name: string;
  roleCompany: string;
  quote: string;
  status: "pending" | "approved" | "hidden";
  dateLabel: string;
}

export function TestimonialsManager({ rows }: { rows: AdminTestimonialRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — refresh this page and try again (the app may have just been updated).", ok: false });
      }
    });
  }

  const label: Record<AdminTestimonialRow["status"], string> = {
    pending: "Pending review",
    approved: "Live on the landing page",
    hidden: "Hidden",
  };

  return (
    <div>
      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginBottom: 10 }}
        >
          {msg.text}
        </div>
      )}
      {rows.length === 0 && (
        <div className="sessions-empty">
          No testimonials yet — members are asked on their dashboard after
          two weeks of membership.
        </div>
      )}
      {rows.map((t) => (
        <div
          key={t.id}
          className="card"
          style={{ marginBottom: 12, padding: "14px 18px" }}
        >
          <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
            &ldquo;{t.quote}&rdquo;
          </div>
          <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
            — <strong>{t.name}</strong>
            {t.roleCompany ? `, ${t.roleCompany}` : ""} · submitted {t.dateLabel} ·{" "}
            {label[t.status]}
          </div>
          <div className="admin-actions-cell">
            {t.status !== "approved" && (
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => run(() => setTestimonialStatus(t.id, "approved"))}
              >
                Approve &amp; publish
              </button>
            )}
            {t.status === "approved" && (
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => run(() => setTestimonialStatus(t.id, "hidden"))}
              >
                Hide from landing page
              </button>
            )}
            <button
              type="button"
              className="btn-mini danger"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete ${t.name}'s testimonial permanently?`)) {
                  run(() => deleteTestimonial(t.id));
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
