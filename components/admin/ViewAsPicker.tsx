"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startViewAs } from "@/app/(portal)/admin/control-center/view-as-actions";

/* "View as a member" — available to every admin (Matt, 2026-08-05), not just
   Super Admins: the preview only ever narrows what the signer already sees.
   Rendered on the admin home for all admins; the Control Center keeps its
   own copy for Supers. A banner stays on every page until they exit. */
export function ViewAsPicker({
  tiers,
}: {
  tiers: { slug: string; label: string }[];
}) {
  const router = useRouter();
  const [tier, setTier] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="admin-form" style={{ marginBottom: 24 }}>
      <div className="admin-field">
        <label htmlFor="home-view-as">
          View as a member — browse the portal exactly the way a member type
          sees it (locked tabs, upgrade prompts, the lot). Nothing you do
          changes their accounts, and a bar stays on top until you exit.
        </label>
        <select
          id="home-view-as"
          value={tier}
          onChange={(e) => setTier(e.target.value)}
        >
          <option value="">— pick a member type —</option>
          {tiers.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="admin-form-actions">
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !tier}
          onClick={() =>
            startTransition(async () => {
              const res = await startViewAs(tier);
              if (!res.ok) {
                setMsg(res.message ?? "Something went wrong.");
                return;
              }
              router.push("/dashboard");
              router.refresh();
            })
          }
        >
          {pending ? "Switching…" : "Start viewing as this member"}
        </button>
        {msg && <span className="admin-form-msg err">{msg}</span>}
      </div>
    </div>
  );
}
