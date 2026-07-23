"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";

/* Rendered by the admin layout on every admin page except the hub itself:
   a constant way back to the Admin Dashboard. Section pages keep their own
   contextual back links (e.g. "Back to sessions"), which point at their
   section list, not the hub. */
export function AdminBackLink() {
  const pathname = usePathname();
  if (!pathname || pathname === "/admin") return null;
  return (
    <div className="admin-back-bar">
      <Link href="/admin" className="sess-back" style={{ marginBottom: 0 }}>
        <ArrowLeftIcon size={12} /> Admin Dashboard
      </Link>
    </div>
  );
}
