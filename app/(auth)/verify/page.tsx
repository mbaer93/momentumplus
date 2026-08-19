import { redirect } from "next/navigation";
import { VerifyForm } from "./VerifyForm";
import { getAuthUser } from "@/lib/supabase/server";
import { mfaStatus } from "@/lib/mfa";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Verify it's you | Momentum+" };

/*
 * The second-factor step, deliberately OUTSIDE the admin group.
 *
 * If it lived under /admin the layout's own gate would redirect it to
 * itself, and the only way an admin could reach the page that lets them in
 * would be to already be in.
 */
export default async function VerifyPage(props: {
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const params = await props.searchParams;
  const raw = params?.redirect ?? "/admin";
  const back = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/admin";

  if (!isSupabaseConfigured()) redirect(back);
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const status = await mfaStatus();
  // Nothing to do — either no factor, or this session already passed it.
  if (!status.mustVerify) redirect(back);

  return (
    <div className="login-inner" style={{ width: 420, maxWidth: "100%" }}>
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Verify it&apos;s you</div>
      <VerifyForm redirectTo={back} />
    </div>
  );
}
