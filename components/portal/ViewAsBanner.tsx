"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { stopViewAs } from "@/app/(portal)/admin/control-center/view-as-actions";
import { LockIcon } from "@/components/icons";

/**
 * Fixed bar shown for the whole time a Super Admin is previewing the portal
 * as another tier. Deliberately impossible to miss: the failure mode worth
 * designing against is forgetting you're in it and reporting a bug against
 * access you switched off yourself.
 */
export function ViewAsBanner({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="view-as-bar" role="status">
      <span className="view-as-icon" aria-hidden>
        <LockIcon size={13} />
      </span>
      <span>
        Viewing as <strong>{label}</strong> — you&apos;re seeing exactly what
        they see.
      </span>
      <button
        type="button"
        className="view-as-exit"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await stopViewAs();
            router.replace("/admin/control-center");
            router.refresh();
          })
        }
      >
        {pending ? "Leaving…" : "Exit preview"}
      </button>
    </div>
  );
}
