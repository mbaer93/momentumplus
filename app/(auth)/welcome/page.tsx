import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WelcomeForm } from "./WelcomeForm";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { emailPattern } from "@/lib/db-utils";

export const metadata = {
  title: "Welcome | Momentum+",
};

/*
 * First-login landing for invited members: the invite email signs them in
 * via /auth/callback?redirect=/welcome; here they set a password, complete
 * their profile, and enter the portal.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams?: { mode?: string; step?: string };
}) {
  const mode = searchParams?.mode === "reset" ? "reset" : "welcome";
  // ?step=profile: an already-passworded member is missing their name —
  // the portal gate sends them here to finish just the profile step.
  const startAtProfile = searchParams?.step === "profile";
  let email = "";
  // Recovery links land here too — a long-standing member resetting their
  // password walks the same steps, so the profile form MUST start from
  // their existing details or "Finish" overwrites them with blanks.
  let initialProfile = {
    full_name: "",
    company: "",
    title: "",
    phone: "",
    industry: "",
    bio: "",
  };
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      email = user.email ?? "";

      // Invite links land here regardless of what KIND of invite they were
      // (the email template's redirect is fixed). Speakers and sponsor reps
      // have their own onboarding that also grants their access — route
      // them there instead of the generic member walkthrough. Password
      // resets stay here (mode=reset).
      if (
        mode !== "reset" &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ) {
        const admin = createServiceClient();
        const [{ data: speakerInvite }, { data: sponsorInvite }] =
          await Promise.all([
            email
              ? admin
                  .from("speaker_invites")
                  .select("id")
                  .ilike("email", emailPattern(email))
                  .is("completed_at", null)
                  .limit(1)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            admin
              .from("sponsor_invites")
              .select("id")
              .eq("invited_profile_id", user.id)
              .is("completed_at", null)
              .limit(1)
              .maybeSingle(),
          ]);
        if (speakerInvite) redirect("/speaker-onboarding");
        if (sponsorInvite) redirect("/sponsor-onboarding");
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, company, title, phone, industry, bio")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        initialProfile = {
          full_name: profile.full_name ?? "",
          company: profile.company ?? "",
          title: profile.title ?? "",
          phone: profile.phone ?? "",
          industry: profile.industry ?? "",
          bio: profile.bio ?? "",
        };
      }
    }
  }

  return (
    <div className="login-inner">
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Premium Member Portal</div>
      <Suspense fallback={<div className="login-card">Loading…</div>}>
        <WelcomeForm
          initialProfile={initialProfile}
          email={email}
          mode={mode}
          startAtProfile={startAtProfile}
        />
      </Suspense>
    </div>
  );
}
