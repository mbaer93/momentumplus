import { getAuthUser } from "@/lib/supabase/server";

/*
 * "Signed in as … · Not you? Log out" — the way OUT of a forced-setup page.
 *
 * Matt, 2026-08-19: a one-time sign-in link minted for a speaker opened in
 * his own browser, which replaced his session with that speaker's. Every
 * portal route then bounced him to /expired, which bounces anyone holding
 * an open speaker invite to /speaker-onboarding — a page with no topbar,
 * and therefore no log-out control anywhere on it. He was not "unable to
 * log out" by accident: there was no control to press, and the only escape
 * was clearing cookies by hand.
 *
 * Any page that a signed-in user can be REDIRECTED into, and cannot
 * navigate out of, needs this. It also answers the quieter version of the
 * same problem: a speaker who has two email addresses and got sent here as
 * the wrong one now has a way to switch.
 */
export async function SignedInAs() {
  const user = await getAuthUser();
  if (!user?.email) return null;

  return (
    <div className="login-alt" style={{ marginTop: 16, textAlign: "center" }}>
      Signed in as {user.email}.{" "}
      <form action="/auth/signout" method="post" style={{ display: "inline" }}>
        <button type="submit">Not you? Log out</button>
      </form>
    </div>
  );
}
