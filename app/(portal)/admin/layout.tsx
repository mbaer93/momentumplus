import { redirect } from "next/navigation";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { requireAdmin } from "@/lib/auth-helpers";
import { mfaStatus } from "@/lib/mfa";
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

    /*
     * Second factor, when the account has one (2026-08-19). The gate keys
     * off the FACTOR, not a role: an admin who has enrolled must always
     * pass it, and an admin who has not is never locked out of the tool
     * they would use to enrol. Enrolment is on /admin/security.
     */
    const mfa = await mfaStatus();
    if (mfa.mustVerify) redirect("/verify?redirect=/admin");
  }
  return (
    <>
      <AdminBackLink />
      {children}
    </>
  );
}
