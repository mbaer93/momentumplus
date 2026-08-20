"use client";

import { useEffect, useState, useTransition } from "react";
import {
  listParkedGuests,
  rehearseReveal,
  type ParkedGuest,
} from "@/app/(portal)/admin/control-center/actions";

/*
 * Rehearse the reveal on one guest (Matt, 2026-08-20).
 *
 * The reveal could not be tested: firing it activated every parked row, so
 * proving the chain worked meant spoiling it for everyone. The first real
 * execution would have been on stage, on a path nobody had run —
 * activation → membership → email → one-time link → /welcome → password →
 * portal.
 *
 * A button rather than a curl command, for three reasons. The reveal key
 * cannot be read back out of Vercel, so the terminal route needs a secret
 * Matt may not still have. This is behind Super Admin plus two-factor,
 * which is stricter than "anyone holding the key". And it lists who is
 * actually parked, instead of asking him to guess an address.
 */

export function RevealRehearsal() {
  const [guests, setGuests] = useState<ParkedGuest[] | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void listParkedGuests().then((res) => {
      setGuests(res.guests);
      if (!res.ok && res.message) setMsg({ ok: false, text: res.message });
    });
  }, []);

  const chosen = guests?.find((g) => g.email === email) ?? null;

  return (
    <>
      <div className="section-header">
        <div>
          <h2>Rehearse the reveal</h2>
          <p>
            Activate <strong>one</strong> waiting guest now and send them the
            real activation email — everyone else stays parked. This is the
            only way to walk the whole chain before the day: the email, the
            one-time link, choosing a password, landing in the portal. The
            full reveal stays TSLS&apos;s button on stage.
          </p>
        </div>
      </div>

      <div className="admin-form" style={{ marginBottom: 32 }}>
        {msg && (
          <div
            className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
            role="status"
            style={{ marginBottom: 12 }}
          >
            {msg.text}
          </div>
        )}

        {guests === null ? (
          <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", margin: 0 }}>
            Loading who&apos;s waiting…
          </p>
        ) : guests.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", margin: 0 }}>
            Nobody is parked. Either TSLS hasn&apos;t pushed any guests yet, or
            they have all been activated.
          </p>
        ) : (
          <>
            <div className="admin-field" style={{ maxWidth: 420 }}>
              <label htmlFor="rehearse-guest">
                Guest ({guests.length} waiting)
              </label>
              <select
                id="rehearse-guest"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setConfirming(false);
                  setMsg(null);
                }}
              >
                <option value="">— pick one —</option>
                {guests.map((g) => (
                  <option key={g.email} value={g.email}>
                    {g.name ? `${g.name} — ` : ""}
                    {g.email} ({g.tier === "tsls_vip" ? "VIP" : "General"},{" "}
                    {g.months} {g.months === 1 ? "month" : "months"})
                  </option>
                ))}
              </select>
            </div>

            {/* Two presses, not one. This sends a real email to a real
                address and cannot be undone — the same reason the endpoint
                has a dryRun. */}
            {!confirming ? (
              <button
                type="button"
                className="btn-gold"
                disabled={!email || pending}
                onClick={() => setConfirming(true)}
              >
                Rehearse on this guest
              </button>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5 }}>
                  This emails <strong>{chosen?.email}</strong> for real and
                  starts their {chosen?.months}-month access today. It
                  can&apos;t be undone.
                </span>
                <button
                  type="button"
                  className="btn-gold"
                  disabled={pending}
                  onClick={() => {
                    setMsg(null);
                    startTransition(async () => {
                      const res = await rehearseReveal(email);
                      setMsg({ ok: res.ok, text: res.message ?? "Done." });
                      setConfirming(false);
                      // Whether it succeeded or not, the parked list may
                      // have changed — a stale dropdown offering someone
                      // already activated is how a double-press happens.
                      const fresh = await listParkedGuests();
                      setGuests(fresh.guests);
                      setEmail("");
                    });
                  }}
                >
                  {pending ? "Sending…" : "Yes — send it"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
