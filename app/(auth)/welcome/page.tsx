import { Suspense } from "react";
import { WelcomeForm } from "./WelcomeForm";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = {
  title: "Welcome | Momentum+",
};

/*
 * First-login landing for invited members: the invite email signs them in
 * via /auth/callback?redirect=/welcome; here they set a password, complete
 * their profile, and enter the portal.
 */
export default async function WelcomePage() {
  let initialName = "";
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      initialName = profile?.full_name ?? "";
    }
  }

  return (
    <div className="login-inner">
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Premium Member Portal</div>
      <Suspense fallback={<div className="login-card">Loading…</div>}>
        <WelcomeForm initialName={initialName} />
      </Suspense>
    </div>
  );
}
