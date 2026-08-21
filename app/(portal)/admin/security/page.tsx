import { MfaSetup } from "@/components/admin/MfaSetup";
import { getAdminAccess } from "@/lib/auth-helpers";
import { listTotpFactors } from "@/lib/mfa";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Security | Momentum+ Admin" };

/*
 * The admin's own account security. Deliberately about THIS account and no
 * one else's — a second factor another administrator could add or remove
 * for you is a formality, not a factor.
 */
export default async function AdminSecurityPage() {
  const access = await getAdminAccess();
  const factors = isSupabaseConfigured() ? await listTotpFactors() : [];

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2 style={{ fontSize: 17 }}>Your account security</h2>
          <p>Two-factor authentication for this admin account</p>
        </div>
      </div>
      <MfaSetup factors={factors} isSuper={access?.role === "super"} />
    </div>
  );
}
