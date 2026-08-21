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

    /*
     * "Owes a second factor" is not "not an admin", and this line used to
     * treat them the same.
     *
     * requireAdmin checks MFA itself (so every server action re-checks
     * independently), and returns ok:false for both. The blanket
     * redirect-to-dashboard below meant that the day the Super Admin
     * enrolled, every admin page bounced him with no explanation and no
     * route to /verify — locked out by the gate built to prevent exactly
     * that (2026-08-20). Send him to the page that fixes it instead.
     */
    if (!auth.ok) {
      redirect(auth.reason === "needs-mfa" ? "/verify?redirect=/admin" : "/dashboard");
    }

    /*
     * Belt and braces. requireAdmin covers this, but the check is cheap and
     * this layout is the one place a wrong answer strands somebody with no
     * way forward.
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
