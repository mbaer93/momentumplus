import Link from "next/link";
import { EditIcon, PlusIcon } from "@/components/icons";

/*
 * Inline admin-only controls rendered on member-facing pages. Pages only
 * render these when the viewer is an admin; the linked admin routes are
 * additionally guarded server-side (requireAdmin + RLS).
 */

export function AdminEditChip({
  href,
  label = "Edit",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link href={href} className="admin-edit-chip">
      <EditIcon size={11} /> {label}
    </Link>
  );
}

export function AdminAddChip({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link href={href} className="admin-edit-chip">
      <PlusIcon size={11} /> {label}
    </Link>
  );
}
