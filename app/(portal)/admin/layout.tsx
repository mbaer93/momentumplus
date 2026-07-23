import { redirect } from "next/navigation";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { requireAdmin } from "@/lib/auth-helpers";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Admin routes require the admin tier (SPEC.md §5). Server actions and API
// routes re-check independently; this gate covers the pages themselves.
// Preview mode (no Supabase) passes through so the UI stays reviewable.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isSupabaseConfigured()) {
    const auth = await requireAdmin();
    if (!auth.ok) redirect("/dashboard");
  }
  return (
    <>
      <AdminBackLink />
      {children}
    </>
  );
}
