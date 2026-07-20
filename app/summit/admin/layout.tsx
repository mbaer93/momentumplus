import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-helpers";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Summit admin lives inside the summit app (kept out of the Momentum+ admin
// portal on purpose — the event companion is a separate product surface).
// Same gate semantics as /(portal)/admin: admin tier required; preview mode
// passes through so the UI stays reviewable.
export default async function SummitAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isSupabaseConfigured()) {
    const auth = await requireAdmin();
    if (!auth.ok) redirect("/summit");
  }
  return <>{children}</>;
}
