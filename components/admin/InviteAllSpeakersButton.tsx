"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteAllSpeakerListings } from "@/app/(portal)/admin/speakers/actions";

/* One-click login invites for every speaker who still needs one (Matt,
   2026-08-05): emails ride over from TSLS; login info goes out only when
   an admin clicks. Skips speakers with accounts, pending invites, or no
   email — safe to click repeatedly. A confirm guards the send since this
   emails real people. */
export function InviteAllSpeakersButton({
  uninvitedCount,
}: {
  uninvitedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn-ghost"
        disabled={pending || uninvitedCount === 0}
        title={
          uninvitedCount === 0
            ? "Every speaker with an email already has a login or a pending invite."
            : undefined
        }
        onClick={() => {
          if (
            !window.confirm(
              `Email login invites to ${uninvitedCount} speaker${uninvitedCount === 1 ? "" : "s"} who don't have one yet?`,
            )
          ) {
            return;
          }
          startTransition(async () => {
            const res = await inviteAllSpeakerListings();
            setStatus({
              ok: res.ok,
              text: res.message ?? (res.ok ? "Done" : "Something went wrong"),
            });
            if (res.ok) router.refresh();
          });
        }}
      >
        {pending
          ? "Sending…"
          : `Invite all speakers${uninvitedCount > 0 ? ` (${uninvitedCount})` : ""}`}
      </button>
      {status && (
        <span
          style={{
            fontSize: 12.5,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}
